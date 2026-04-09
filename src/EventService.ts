import { DatabaseManager, type Participant } from './Database.js';

export interface StatusData {
  title: string;
  slots: number;
  participants: Participant[];
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

  createEvent(chatId: string, title: string, slots: number, userId: string): ServiceResult {
    const existing = this.db.getActiveEvent(chatId);
    if (existing) {
      return { success: false, messageKey: 'activeEventExists' };
    }

    this.db.createEvent(chatId, title, slots, true, userId);
    return { success: true, messageKey: 'eventCreated', params: [title, slots] };
  }

  joinEvent(chatId: string, userId: string, userName: string, forceWaitlist: boolean = false): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };

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

    // Check permissions
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

    // If it's a guest being removed by someone else
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
        participants
      }
    };
  }

  makeGroups(eventId: number, membersPerGroup: number = 4): Participant[][] {
    const participants = this.db.getParticipants(eventId);
    const joined = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion');

    if (joined.length === 0) return [];

    // Fisher-Yates shuffle
    for (let i = joined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [joined[i], joined[j]] = [joined[j], joined[i]];
    }

    const numGroups = Math.ceil(joined.length / membersPerGroup);
    const groups: Participant[][] = Array.from({ length: numGroups }, () => []);

    // Round-robin distribution
    for (let i = 0; i < joined.length; i++) {
      groups[i % numGroups].push(joined[i]);
    }

    return groups;
  }
}
