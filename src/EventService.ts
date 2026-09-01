import { DatabaseManager, type Participant } from './Database.js';
import type { Locale, MessageTemplates } from './i18n.js';
import { formatEventDate, formatAbsenceGap } from './formatters.js';
import { t } from './i18n.js';
import { summarizeHistory, selectJoinCheer, STREAK_LOSS_MIN } from './participation.js';

export interface StatusData {
  title: string;
  slots: number;
  participants: Participant[];
  event_at: string | undefined;
  timezone: string | undefined;
}

export interface ServiceResult {
  success: boolean;
  messageKey: string;
  params?: any[];
  mentions?: string[];
  showStatus?: boolean;
  groupsUpdated?: boolean;
  promotion?: {
    userId: string;
    userName: string;
    eventTitle: string;
  };
  promotions?: Array<{ userId: string; userName: string }>;
  data?: StatusData;
  /**
   * The locale this result was built with, when the method resolved one.
   *
   * The handler renders with this rather than its own snapshot. Both read the
   * same chat setting, but a !lang command arriving in another batch during an
   * awaited group-metadata lookup can change it in between, which would
   * otherwise split a single reply across two languages.
   */
  locale?: Locale;
  cheer?: ServiceCheer;
  streakLoss?: { userId: string; streak: number };
}

/**
 * A cheer names its own template key. Typing the key against MessageTemplates
 * keeps a typo or a reordered signature a compile error, since CommandHandler
 * deliberately swallows cheer send failures at runtime.
 */
export interface ServiceCheer {
  messageKey: keyof MessageTemplates;
  params: any[];
  mentions: string[];
}

/** Guest sign-ups get a synthetic id per invite, so they have no history to read. */
function isGuestId(userId: string): boolean {
  return userId.startsWith('guest:');
}

export class EventService {
  constructor(private db: DatabaseManager) { }

  createEvent(chatId: string, title: string, slots: number, userId: string, eventAt?: string, timezone?: string, closeAndGroupOffsetMin?: number): ServiceResult {
    const locale = this.db.getLocale(chatId);
    const existing = this.db.getActiveEvent(chatId);
    if (existing) {
      return { success: false, messageKey: 'activeEventExists', locale };
    }

    this.db.createEvent(chatId, title, slots, true, userId, eventAt, timezone, closeAndGroupOffsetMin);

    if (eventAt && timezone) {
      const dateStr = formatEventDate(eventAt, timezone, locale);
      return { success: true, messageKey: 'eventScheduled', params: [title, slots, dateStr], locale };
    }
    return { success: true, messageKey: 'eventCreated', params: [title, slots], locale };
  }

  rescheduleEvent(chatId: string, eventAt: string, timezone: string, closeAndGroupOffsetMin?: number): ServiceResult {
    const locale = this.db.getLocale(chatId);
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent', locale };
    this.db.updateEventSchedule(event.id, eventAt, timezone, closeAndGroupOffsetMin);
    const dateStr = formatEventDate(eventAt, timezone, locale);
    return { success: true, messageKey: 'eventRescheduled', params: [dateStr], locale };
  }

  /**
   * Builds the cheer for a join that just took a real spot, based on the user's
   * history in this group alone. Returns undefined when the join is unremarkable.
   */
  private buildJoinCheer(chatId: string, eventId: number | bigint, userId: string, locale: Locale): ServiceCheer | undefined {
    if (isGuestId(userId)) return undefined;

    // History only covers past events, so it reads the same before and after a
    // withdrawal from the current one. Without this guard, leaving and rejoining
    // would replay the cheer, contradicting the streak-lost warning in between.
    // See isCheerResolved for what counts as settled.
    if (this.db.isCheerResolved(eventId, userId)) return undefined;

    const summary = summarizeHistory(this.db.getParticipationHistory(chatId, userId));
    const cheer = selectJoinCheer(summary, Date.now());
    if (!cheer) return undefined;

    const mention = userId.split('@')[0] ?? '';
    if (cheer.key === 'cheerStreak') {
      return { messageKey: cheer.key, params: [mention, cheer.streak], mentions: [userId] };
    }
    if (cheer.key === 'cheerComeback') {
      return { messageKey: cheer.key, params: [mention, formatAbsenceGap(cheer.gapMs, locale, t)], mentions: [userId] };
    }
    return { messageKey: cheer.key, params: [mention], mentions: [userId] };
  }

  /**
   * Returns the streak the user stands to lose by withdrawing: the run of past
   * events they attended plus the event they are pulling out of.
   */
  private buildStreakLoss(chatId: string, userId: string): { userId: string; streak: number } | undefined {
    if (isGuestId(userId)) return undefined;

    const summary = summarizeHistory(this.db.getParticipationHistory(chatId, userId));
    const streak = summary.currentStreak + 1;
    if (streak < STREAK_LOSS_MIN) return undefined;
    return { userId, streak };
  }

  joinEvent(chatId: string, userId: string, userName: string, forceWaitlist: boolean = false): ServiceResult {
    const locale = this.db.getLocale(chatId);
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent', locale };

    const existing = this.db.getParticipant(event.id, userId);
    if (existing) {
      if (existing.status === 'pending_promotion') {
        this.db.updateParticipantStatus(event.id, userId, 'joined');
        const result: ServiceResult = {
          success: true,
          messageKey: 'confirmedSpot',
          params: [userId.split('@')[0], event.title],
          mentions: [userId],
          showStatus: true,
          groupsUpdated: !!event.groups_triggered,
          locale
        };
        const cheer = this.buildJoinCheer(chatId, event.id, userId, locale);
        if (cheer) {
          this.db.markCheerResolved(event.id, userId);
          result.cheer = cheer;
        }
        return result;
      }
      return {
        success: false,
        messageKey: existing.status === 'joined' ? 'alreadyJoined' : 'alreadyWaitlisted',
        locale
      };
    }

    if (event.groups_triggered) {
      return { success: false, messageKey: 'registrationsClosed', locale };
    }

    const participants = this.db.getParticipants(event.id);
    const joinedCount = participants.filter((p: Participant) => p.status === 'joined' || p.status === 'pending_promotion').length;

    if (!forceWaitlist && joinedCount < event.slots) {
      // Build the cheer before inserting, so isCheerResolved is read against the
      // rows that existed before this join, then record it against the new row.
      const cheer = this.buildJoinCheer(chatId, event.id, userId, locale);
      this.db.addParticipant(event.id, userId, userName, 'joined', undefined, undefined, 'join');
      const result: ServiceResult = {
        success: true,
        messageKey: 'joined',
        params: [userId.split('@')[0], event.title],
        mentions: [userId],
        showStatus: true,
        locale
      };
      if (cheer) {
        this.db.markCheerResolved(event.id, userId);
        result.cheer = cheer;
      }
      return result;
    } else if (event.waitlist_enabled) {
      this.db.addParticipant(event.id, userId, userName, 'waitlisted', undefined, undefined, forceWaitlist ? 'waitlist' : 'join');
      return {
        success: true,
        messageKey: 'joinedWaitlist',
        params: [userId.split('@')[0], event.title],
        mentions: [userId],
        showStatus: true,
        locale
      };
    } else {
      return { success: false, messageKey: 'eventFullNoWaitlist', locale };
    }
  }

  inviteGuest(chatId: string, inviterId: string, inviterName: string, guestName: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };

    if (event.groups_triggered) {
      return { success: false, messageKey: 'registrationsClosed' };
    }

    const guestId = `guest:${Date.now()}:${inviterId.split('@')[0]}`;
    const participants = this.db.getParticipants(event.id);
    const joinedCount = participants.filter((p: Participant) => p.status === 'joined' || p.status === 'pending_promotion').length;

    if (joinedCount < event.slots) {
      this.db.addParticipant(event.id, guestId, guestName, 'joined', inviterId, inviterName);
      return {
        success: true,
        messageKey: 'guestJoined',
        params: [guestName, inviterName, event.title],
        showStatus: true
      };
    } else if (event.waitlist_enabled) {
      this.db.addParticipant(event.id, guestId, guestName, 'waitlisted', inviterId, inviterName);
      return {
        success: true,
        messageKey: 'guestJoinedWaitlist',
        params: [guestName, inviterName, event.title],
        showStatus: true
      };
    } else {
      return { success: false, messageKey: 'eventFullNoWaitlist' };
    }
  }

  leaveEvent(chatId: string, userId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };

    const participant = this.db.getParticipant(event.id, userId);
    if (!participant) return { success: false, messageKey: 'notSignedUp' };

    return this.performWithdrawal(event, participant);
  }

  leaveByIndex(chatId: string, requesterId: string, isAdmin: boolean, index: number): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };

    const participants = this.db.getParticipants(event.id);
    const joined = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion');
    const waitlisted = participants.filter(p => p.status === 'waitlisted');
    const allDisplay = [...joined, ...waitlisted];

    const participant = allDisplay[index - 1];
    if (!participant) return { success: false, messageKey: 'leaveIndexInvalid' };

    const isSelf = participant.user_id === requesterId;
    const isMyGuest = participant.invited_by === requesterId;

    if (!isAdmin && !isSelf && !isMyGuest) {
      return { success: false, messageKey: 'notAuthorizedToLeave' };
    }

    return this.performWithdrawal(event, participant, requesterId);
  }

  private performWithdrawal(event: any, participant: Participant, requesterId?: string): ServiceResult {
    if (event.groups_triggered && !this.db.getNextInWaitlist(event.id)) {
      return { success: false, messageKey: 'leaveLockedNoWaitlist' };
    }

    const oldStatus = participant.status;
    // Only a real spot carries a streak; a waitlisted signup never held one.
    // The warning is second person ("you have lost your streak"), so it is only
    // for someone who chose to leave — never for a member an admin removed.
    const isSelfWithdrawal = !requesterId || requesterId === participant.user_id;
    const heldASpot = oldStatus === 'joined' || oldStatus === 'pending_promotion';
    const streakLoss = isSelfWithdrawal && heldASpot
      ? this.buildStreakLoss(event.chat_id, participant.user_id)
      : undefined;
    this.db.withdrawParticipant(event.id, participant.user_id);

    let messageKey = 'withdrawn';
    let params: any[] = [participant.user_id.split('@')[0], event.title];
    let mentions: string[] = [participant.user_id];

    if (participant.invited_by && requesterId && participant.user_id !== requesterId) {
      messageKey = 'guestWithdrawn';
      params = [participant.user_name, event.title, requesterId.split('@')[0]];
      mentions = [requesterId];
    }

    // Giving up a real spot settles the cheer for this event even when no cheer
    // was ever sent. Otherwise a rejoin could celebrate the very streak the
    // withdrawal just warned about losing. A waitlist place settles nothing.
    if (heldASpot && !isGuestId(participant.user_id)) {
      this.db.markCheerResolved(event.id, participant.user_id);
    }

    const result: ServiceResult = {
      success: true,
      messageKey,
      params,
      mentions,
      showStatus: true
    };

    if (streakLoss) result.streakLoss = streakLoss;

    if (oldStatus === 'joined' || oldStatus === 'pending_promotion') {
      const next = this.db.getNextInWaitlist(event.id);
      if (next) {
        this.db.updateParticipantStatus(event.id, next.user_id, 'pending_promotion');
        result.promotion = {
          userId: next.user_id,
          userName: next.user_name,
          eventTitle: event.title
        };
      }
    }

    return result;
  }

  renameEvent(chatId: string, newTitle: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };
    this.db.updateEventTitle(event.id, newTitle);
    return { success: true, messageKey: 'eventRenamed', params: [event.title, newTitle] };
  }

  resizeEvent(chatId: string, newSlots: number): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };
    if (newSlots <= 0) return { success: false, messageKey: 'resizeInvalidSlots' };

    const participants = this.db.getParticipants(event.id);
    const joined = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion');

    if (newSlots < joined.length) {
      // Downsize: move last-joined participants to waitlist (in reverse order so earliest-demoted ends up first in waitlist)
      const toMove = joined.slice(newSlots).reverse();
      for (const p of toMove) {
        this.db.updateParticipantStatus(event.id, p.user_id, 'waitlisted');
      }
      this.db.updateEventSlots(event.id, newSlots);
      return { success: true, messageKey: 'eventResized', params: [event.title, newSlots], showStatus: true };
    }

    this.db.updateEventSlots(event.id, newSlots);

    // Upsize: auto-promote eligible waitlisters (join_source = 'join') up to the new available slots
    const availableSlots = newSlots - joined.length;
    if (availableSlots > 0) {
      const promotable = this.db.getAutoPromotableWaitlist(event.id).slice(0, availableSlots);
      for (const p of promotable) {
        this.db.updateParticipantStatus(event.id, p.user_id, 'joined');
      }
      if (promotable.length > 0) {
        return {
          success: true,
          messageKey: 'eventResized',
          params: [event.title, newSlots],
          showStatus: true,
          promotions: promotable.map(p => ({ userId: p.user_id, userName: p.user_name }))
        };
      }
    }

    return { success: true, messageKey: 'eventResized', params: [event.title, newSlots], showStatus: true };
  }

  cancelEvent(chatId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEventCancel' };

    this.db.cancelEvent(event.id);
    return { success: true, messageKey: 'eventCancelled', params: [event.title] };
  }

  /**
   * Concludes one specific event. Callers that already hold an event — the
   * scheduler iterating expired events — must use this rather than the
   * chat-based variant, which re-resolves to whichever event is newest and can
   * therefore conclude a different one than the caller was looking at.
   */
  concludeEventById(eventId: number | bigint): void {
    this.db.concludeEvent(eventId);
  }

  concludeEvent(chatId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEventConclude' };

    // Concluding early would put a future event into participation history,
    // where it counts as a past event everyone who had not signed up yet
    // missed — resetting their streaks over an event that has not happened.
    // The !finish alias reads like "close sign-ups", so this is easy to hit.
    if (event.event_at && Date.parse(event.event_at) > Date.now()) {
      return { success: false, messageKey: 'concludeBeforeEventTime' };
    }

    this.db.concludeEvent(event.id);
    return { success: true, messageKey: 'eventConcluded', params: [event.title] };
  }

  getStatus(chatId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEventStatus' };

    const participants = this.db.getParticipants(event.id);
    return {
      success: true,
      messageKey: 'status',
      data: {
        title: event.title,
        slots: event.slots,
        participants,
        event_at: event.event_at,
        timezone: event.timezone,
      }
    };
  }

  makeGroups(eventId: number, membersPerGroup: number = 4): Participant[][] {
    const participants = this.db.getParticipants(eventId);
    const joined = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion');

    if (joined.length === 0) return [];

    for (let i = joined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = joined[i]!; joined[i] = joined[j]!; joined[j] = tmp;
    }

    const numGroups = Math.ceil(joined.length / membersPerGroup);
    const groups: Participant[][] = Array.from({ length: numGroups }, () => []);

    for (let i = 0; i < joined.length; i++) {
      groups[i % numGroups]!.push(joined[i]!);
    }

    return groups;
  }
}
