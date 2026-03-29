import { DatabaseManager, type Participant } from './Database.js';

export interface ServiceResult {
  success: boolean;
  messageKey: string;
  params?: any[];
  mentions?: string[];
  showStatus?: boolean;
}

export class EventService {
  constructor(private db: DatabaseManager) {}

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
    const joinedCount = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion').length;

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

  leaveEvent(chatId: string, userId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEvent' };

    const participant = this.db.getParticipant(event.id, userId);
    if (!participant) return { success: false, messageKey: 'notSignedUp' };

    const oldStatus = participant.status;
    this.db.withdrawParticipant(event.id, userId);
    
    const result: ServiceResult = {
      success: true,
      messageKey: 'withdrawn',
      params: [userId.split('@')[0], event.title],
      mentions: [userId]
    };

    if (oldStatus === 'joined' || oldStatus === 'pending_promotion') {
      const next = this.db.getNextInWaitlist(event.id);
      if (next) {
        this.db.updateParticipantStatus(event.id, next.user_id, 'pending_promotion');
        (result as any).promotion = {
          userId: next.user_id,
          userName: next.user_name,
          eventTitle: event.title
        };
      }
    }

    return result;
  }

  cancelEvent(chatId: string): ServiceResult {
    const event = this.db.getActiveEvent(chatId);
    if (!event) return { success: false, messageKey: 'noActiveEventCancel' };

    this.db.cancelEvent(event.id);
    return { success: true, messageKey: 'eventCancelled', params: [event.title] };
  }

  getStatus(chatId: string): ServiceResult | { success: true, data: any } {
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
}
