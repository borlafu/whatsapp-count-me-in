import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scheduler } from '../Scheduler.js';
import { EventService } from '../EventService.js';
import { DatabaseManager } from '../Database.js';

describe('Scheduler', () => {
  let db: DatabaseManager;
  let eventService: EventService;
  let sendMessage: ReturnType<typeof vi.fn<(chatId: string, text: string) => Promise<void>>>;
  let scheduler: Scheduler;

  const chatId = '12345@g.us';
  const adminId = 'admin@s.whatsapp.net';

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    eventService = new EventService(db);
    sendMessage = vi.fn().mockResolvedValue(undefined);
  });

  function createScheduler(nowMs: number) {
    scheduler = new Scheduler(
      db,
      eventService,
      sendMessage,
      (cid) => db.getLocale(cid),
      () => nowMs,
    );
    return scheduler;
  }

  describe('auto-cancel', () => {
    it('should cancel an event whose scheduled time has passed', () => {
      const eventAt = '2026-04-15T18:00:00.000Z';
      eventService.createEvent(chatId, 'Past Event', 10, adminId, eventAt, 'UTC');

      // "now" is after the event time
      const nowMs = Date.parse('2026-04-15T18:01:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Past Event')
      );
      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('cancelled')
      );
      expect(db.getActiveEvent(chatId)).toBeUndefined();
    });

    it('should not cancel an event that is still in the future', () => {
      const eventAt = '2026-04-15T18:00:00.000Z';
      eventService.createEvent(chatId, 'Future Event', 10, adminId, eventAt, 'UTC');

      const nowMs = Date.parse('2026-04-15T10:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(db.getActiveEvent(chatId)).toBeDefined();
    });
  });

  describe('close-and-group trigger', () => {
    it('should trigger groups when within the offset window', () => {
      const eventAt = '2026-04-15T18:00:00.000Z';
      // close-and-group 1h before event = triggers at 17:00
      eventService.createEvent(chatId, 'Group Event', 10, adminId, eventAt, 'UTC', 60);

      // Add participants so groups can form
      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, 'u1@s.whatsapp.net', 'User 1', 'joined');
      db.addParticipant(event.id, 'u2@s.whatsapp.net', 'User 2', 'joined');
      db.addParticipant(event.id, 'u3@s.whatsapp.net', 'User 3', 'joined');
      db.addParticipant(event.id, 'u4@s.whatsapp.net', 'User 4', 'joined');

      // "now" is 30min before event (within the 1h window)
      const nowMs = Date.parse('2026-04-15T17:30:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('closed')
      );
      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Group 1')
      );

      // groups_triggered flag should be set
      const updatedEvent = db.getActiveEvent(chatId)!;
      expect(updatedEvent.groups_triggered).toBe(1);
    });

    it('should not trigger groups when outside the offset window', () => {
      const eventAt = '2026-04-15T18:00:00.000Z';
      eventService.createEvent(chatId, 'Group Event', 10, adminId, eventAt, 'UTC', 60);

      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, 'u1@s.whatsapp.net', 'User 1', 'joined');
      db.addParticipant(event.id, 'u2@s.whatsapp.net', 'User 2', 'joined');

      // "now" is 2h before event (outside the 1h window)
      const nowMs = Date.parse('2026-04-15T16:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should not trigger groups twice (groups_triggered flag)', () => {
      const eventAt = '2026-04-15T18:00:00.000Z';
      eventService.createEvent(chatId, 'Group Event', 10, adminId, eventAt, 'UTC', 60);

      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, 'u1@s.whatsapp.net', 'User 1', 'joined');
      db.addParticipant(event.id, 'u2@s.whatsapp.net', 'User 2', 'joined');

      const nowMs = Date.parse('2026-04-15T17:30:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      sendMessage.mockClear();

      // Tick again at the same time — should NOT trigger again
      const s2 = createScheduler(nowMs);
      s2.start();
      s2.stop();

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should block joins after groups are triggered', () => {
      const eventAt = '2026-04-15T18:00:00.000Z';
      eventService.createEvent(chatId, 'Group Event', 10, adminId, eventAt, 'UTC', 60);

      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, 'u1@s.whatsapp.net', 'User 1', 'joined');
      db.addParticipant(event.id, 'u2@s.whatsapp.net', 'User 2', 'joined');

      // Trigger close-and-group
      const nowMs = Date.parse('2026-04-15T17:30:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      // Now try to join — should be blocked
      const joinResult = eventService.joinEvent(chatId, 'u3@s.whatsapp.net', 'User 3');
      expect(joinResult.success).toBe(false);
      expect(joinResult.messageKey).toBe('registrationsClosed');

      // Same for invites
      const inviteResult = eventService.inviteGuest(chatId, 'u1@s.whatsapp.net', 'User 1', 'Guest');
      expect(inviteResult.success).toBe(false);
      expect(inviteResult.messageKey).toBe('registrationsClosed');
    });
  });

  describe('daily reminders', () => {
    it('should send a reminder at 09:00 UTC', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Reminder Event', 10, adminId, eventAt, 'UTC');

      // "now" is 09:00 UTC on April 15
      const nowMs = Date.parse('2026-04-15T09:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Reminder')
      );
      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Reminder Event')
      );
    });

    it('should send a reminder at 09:01 UTC (within window)', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Reminder Event', 10, adminId, eventAt, 'UTC');

      // "now" is 09:01 UTC — should still trigger
      const nowMs = Date.parse('2026-04-15T09:01:30.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Reminder')
      );
    });

    it('should not send a reminder outside the 09:00 window', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Reminder Event', 10, adminId, eventAt, 'UTC');

      const nowMs = Date.parse('2026-04-15T10:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should not send duplicate reminders on the same day', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Reminder Event', 10, adminId, eventAt, 'UTC');

      // First tick at 09:00
      const nowMs = Date.parse('2026-04-15T09:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      sendMessage.mockClear();

      // Second tick at 09:01 same day — should NOT send again
      const nowMs2 = Date.parse('2026-04-15T09:01:00.000Z');
      const s2 = createScheduler(nowMs2);
      s2.start();
      s2.stop();

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should send reminders on different days', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Reminder Event', 10, adminId, eventAt, 'UTC');

      // Day 1
      const s1 = createScheduler(Date.parse('2026-04-15T09:00:00.000Z'));
      s1.start();
      s1.stop();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      sendMessage.mockClear();

      // Day 2
      const s2 = createScheduler(Date.parse('2026-04-16T09:00:00.000Z'));
      s2.start();
      s2.stop();

      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('should not send reminders when disabled', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Reminder Event', 10, adminId, eventAt, 'UTC');
      db.setRemindersEnabled(chatId, false);

      const nowMs = Date.parse('2026-04-15T09:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should include available slots and countdown in reminder', () => {
      const eventAt = '2026-04-20T18:00:00.000Z';
      eventService.createEvent(chatId, 'Slots Event', 5, adminId, eventAt, 'UTC');

      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, 'u1@s.whatsapp.net', 'User 1', 'joined');
      db.addParticipant(event.id, 'u2@s.whatsapp.net', 'User 2', 'joined');

      const nowMs = Date.parse('2026-04-15T09:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      // 3 available out of 5
      expect(sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('3/5')
      );
    });
  });

  describe('events without scheduling', () => {
    it('should ignore events without event_at', () => {
      eventService.createEvent(chatId, 'No Date Event', 10, adminId);

      const nowMs = Date.parse('2026-04-15T09:00:00.000Z');
      const s = createScheduler(nowMs);
      s.start();
      s.stop();

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});
