import { DatabaseManager, type Participant } from './Database.js';

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
  promotion?: {
    userId: string;
    userName: string;
    eventTitle: string;
  };
  data?: StatusData;
}

export class EventService {
  constructor(private db: DatabaseManager) { }

  createEvent(chatId: string, title: string, slots: number, userId: string, eventAt?: string, timezone?: string, closeAndGroupOffsetMin?: number): ServiceResult {
    const existing = this.db.getActiveEvent(chatId);
    if (existing) {
      return { success: false, messageKey: 'activeEventExists' };
    }

    this.db.createEvent(chatId, title, slots, true, userId, eventAt, timezone, closeAndGroupOffsetMin);

    if (eventAt && timezone) {
      const dateStr = formatEventDate(eventAt, timezone);
      return { success: true, messageKey: 'eventScheduled', params: [title, slots, dateStr] };
    }
    return { success: true, messageKey: 'eventCreated', params: [title, slots] };
  }

  rescheduleEvent(chatId: string, eventAt: string, timezone: string, closeAndGroupOffsetMin?: number): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };
    this.db.updateEventSchedule(event.id, eventAt, timezone, closeAndGroupOffsetMin);
    const dateStr = formatEventDate(eventAt, timezone);
    return { success: true, messageKey: 'eventRescheduled', params: [dateStr] };
  }

  joinEvent(chatId: string, userId: string, userName: string, forceWaitlist: boolean = false): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };

    if (event.groups_triggered) {
      return { success: false, messageKey: 'registrationsClosed' };
    }

    const existing = this.db.getParticipant(event.id, userId);
    if (existing) {
      if (existing.status === 'pending_promotion') {
        this.db.updateParticipantStatus(event.id, userId, 'joined');
        return {
          success: true,
          messageKey: 'confirmedSpot',
          params: [userId.split('@')[0], event.title],
          mentions: [userId],
          showStatus: true
        };
      }
      return {
        success: false,
        messageKey: existing.status === 'joined' ? 'alreadyJoined' : 'alreadyWaitlisted'
      };
    }

    const participants = this.db.getParticipants(event.id);
    const joinedCount = participants.filter((p: Participant) => p.status === 'joined' || p.status === 'pending_promotion').length;

    if (!forceWaitlist && joinedCount < event.slots) {
      this.db.addParticipant(event.id, userId, userName, 'joined');
      return {
        success: true,
        messageKey: 'joined',
        params: [userId.split('@')[0], event.title],
        mentions: [userId],
        showStatus: true
      };
    } else if (event.waitlist_enabled) {
      this.db.addParticipant(event.id, userId, userName, 'waitlisted');
      return {
        success: true,
        messageKey: 'joinedWaitlist',
        params: [userId.split('@')[0], event.title],
        mentions: [userId],
        showStatus: true
      };
    } else {
      return { success: false, messageKey: 'eventFullNoWaitlist' };
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
    const oldStatus = participant.status;
    this.db.withdrawParticipant(event.id, participant.user_id);

    let messageKey = 'withdrawn';
    let params: any[] = [participant.user_id.split('@')[0], event.title];
    let mentions: string[] = [participant.user_id];

    if (participant.invited_by && requesterId && participant.user_id !== requesterId) {
      messageKey = 'guestWithdrawn';
      params = [participant.user_name, event.title, requesterId.split('@')[0]];
      mentions = [requesterId];
    }

    const result: ServiceResult = {
      success: true,
      messageKey,
      params,
      mentions,
      showStatus: true
    };

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
      const toMove = joined.slice(newSlots).reverse();
      for (const p of toMove) {
        this.db.updateParticipantStatus(event.id, p.user_id, 'waitlisted');
      }
    }

    this.db.updateEventSlots(event.id, newSlots);
    return { success: true, messageKey: 'eventResized', params: [event.title, newSlots], showStatus: true };
  }

  cancelEvent(chatId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEventCancel' };

    this.db.cancelEvent(event.id);
    return { success: true, messageKey: 'eventCancelled', params: [event.title] };
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

/** Formats a UTC ISO string as a human-readable date in the given timezone. */
export function formatEventDate(eventAt: string, timezone: string): string {
  const date = new Date(eventAt);
  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart} · ${timePart}`;
}

/** Converts a local date/time string + IANA timezone to a UTC ISO string. */
export function localToUtc(dateStr: string, timeStr: string, timezone: string): string | null {
  try {
    // Build a date in the target timezone by finding the UTC time that corresponds
    // to the given local time. We use the Intl API to verify the offset.
    const naive = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(naive.getTime())) return null;

    // Get what the local time would be in the target TZ if we used naive as UTC
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    // Binary-search-free approach: use the offset from a reference point
    // Parse the offset by formatting a known UTC time and comparing
    const testDate = new Date(`${dateStr}T${timeStr}:00Z`);
    const parts = formatter.formatToParts(testDate);
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const localInTz = new Date(`${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:${p['second']}Z`);
    const offsetMs = testDate.getTime() - localInTz.getTime();
    const result = new Date(testDate.getTime() + offsetMs);
    return result.toISOString();
  } catch {
    return null;
  }
}

/** Returns a countdown string like "2d 4h" or "3h 20m". */
export function formatCountdown(msUntil: number): string {
  const totalMin = Math.floor(msUntil / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Parses an offset string like "1h", "30m", "2h30m" into minutes. Returns null if invalid. */
export function parseOffsetToMinutes(s: string): number | null {
  const match = s.match(/^(?:(\d+)h)?(?:(\d+)m)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return (parseInt(match[1] ?? '0') * 60) + parseInt(match[2] ?? '0');
}
