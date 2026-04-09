import { describe, it, expect, beforeEach } from 'vitest';
import { EventService } from '../EventService.js';
import { DatabaseManager } from '../Database.js';

describe('EventService', () => {
  let db: DatabaseManager;
  let service: EventService;

  const chatId = '12345@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const user1 = 'user1@s.whatsapp.net';
  const user2 = 'user2@s.whatsapp.net';

  beforeEach(() => {
    // Each test gets a fresh in-memory database
    db = new DatabaseManager(':memory:');
    service = new EventService(db);
  });

  describe('createEvent', () => {
    it('should create an event successfully', () => {
      const result = service.createEvent(chatId, 'Test Event', 2, adminId);
      expect(result.success).toBe(true);
      expect(result.messageKey).toBe('eventCreated');
      expect(result.params).toEqual(['Test Event', 2]);
    });

    it('should not allow creating an event if one is already active', () => {
      service.createEvent(chatId, 'First Event', 2, adminId);
      const result = service.createEvent(chatId, 'Second Event', 5, adminId);
      expect(result.success).toBe(false);
      expect(result.messageKey).toBe('activeEventExists');
    });
  });

  describe('joinEvent', () => {
    it('should allow a user to join an event', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const result = service.joinEvent(chatId, user1, 'User One');
      expect(result.success).toBe(true);
      expect(result.messageKey).toBe('joined');
    });

    it('should add a user to the waitlist if the event is full', () => {
      service.createEvent(chatId, 'Test Event', 1, adminId);
      service.joinEvent(chatId, user1, 'User One');
      const result = service.joinEvent(chatId, user2, 'User Two');
      expect(result.success).toBe(true);
      expect(result.messageKey).toBe('joinedWaitlist');
    });
  });

  describe('leaveEvent', () => {
    it('should promote the first person on the waitlist when someone leaves', () => {
      service.createEvent(chatId, 'Test Event', 1, adminId);
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two'); // Waitlisted

      const result = service.leaveEvent(chatId, user1);
      expect(result.success).toBe(true);
      expect((result as any).promotion).toBeDefined();
      expect((result as any).promotion.userId).toBe(user2);
    });
  });

  describe('renameEvent', () => {
    it('should return error when no active event', () => {
      expect(service.renameEvent(chatId, 'New Name').messageKey).toBe('noActiveEvent');
    });

    it('should rename the active event', () => {
      service.createEvent(chatId, 'Old Name', 5, adminId);
      const result = service.renameEvent(chatId, 'New Name');
      expect(result.success).toBe(true);
      expect(result.params).toEqual(['Old Name', 'New Name']);
      expect(db.getActiveEvent(chatId)?.title).toBe('New Name');
    });
  });

  describe('resizeEvent', () => {
    it('should return error when no active event', () => {
      expect(service.resizeEvent(chatId, 5).messageKey).toBe('noActiveEvent');
    });

    it('should return error for invalid slot count', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      expect(service.resizeEvent(chatId, 0).messageKey).toBe('resizeInvalidSlots');
    });

    it('should update slots', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      service.resizeEvent(chatId, 5);
      expect(db.getActiveEvent(chatId)?.slots).toBe(5);
    });

    it('should demote last-joined participants when slots reduced below count', () => {
      service.createEvent(chatId, 'Test Event', 3, adminId);
      const user3 = 'user3@s.whatsapp.net';
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two');
      service.joinEvent(chatId, user3, 'User Three');

      service.resizeEvent(chatId, 1);

      const event = db.getActiveEvent(chatId)!;
      const all = db.getParticipants(event.id);
      expect(all.filter(p => p.status === 'joined').length).toBe(1);
      expect(all.filter(p => p.status === 'joined')[0].user_id).toBe(user1);
      expect(all.filter(p => p.status === 'waitlisted').length).toBe(2);
    });
  });

  describe('makeGroups', () => {
    it('should split 8 participants into 2 groups of 4', () => {
      service.createEvent(chatId, 'Test Event', 10, adminId);
      const event = db.getActiveEvent(chatId)!;
      for (let i = 1; i <= 8; i++) {
        db.addParticipant(event.id, `user${i}@s.whatsapp.net`, `User ${i}`, 'joined');
      }

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(4);
      expect(groups[1]).toHaveLength(4);
    });

    it('should distribute 10 participants into groups of 4 as 4,3,3', () => {
      service.createEvent(chatId, 'Test Event', 12, adminId);
      const event = db.getActiveEvent(chatId)!;
      for (let i = 1; i <= 10; i++) {
        db.addParticipant(event.id, `user${i}@s.whatsapp.net`, `User ${i}`, 'joined');
      }

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(3);
      const sizes = groups.map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([4, 3, 3]);
    });

    it('should return a single group when membersPerGroup >= participant count', () => {
      service.createEvent(chatId, 'Test Event', 5, adminId);
      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, user1, 'User One', 'joined');
      db.addParticipant(event.id, user2, 'User Two', 'joined');

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(2);
    });

    it('should include every participant exactly once', () => {
      service.createEvent(chatId, 'Test Event', 12, adminId);
      const event = db.getActiveEvent(chatId)!;
      for (let i = 1; i <= 7; i++) {
        db.addParticipant(event.id, `user${i}@s.whatsapp.net`, `User ${i}`, 'joined');
      }

      const groups = service.makeGroups(event.id, 3);
      const allIds = groups.flat().map(p => p.user_id);
      expect(allIds).toHaveLength(7);
      expect(new Set(allIds).size).toBe(7);
    });

    it('should only include joined participants, not waitlisted', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, user1, 'User One', 'joined');
      db.addParticipant(event.id, user2, 'User Two', 'waitlisted');

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(1);
      expect(groups[0][0].user_id).toBe(user1);
    });

    it('should include pending_promotion participants', () => {
      service.createEvent(chatId, 'Test Event', 5, adminId);
      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, user1, 'User One', 'joined');
      db.addParticipant(event.id, user2, 'User Two', 'pending_promotion');

      const groups = service.makeGroups(event.id, 4);
      const allIds = groups.flat().map(p => p.user_id);
      expect(allIds).toHaveLength(2);
      expect(allIds).toContain(user1);
      expect(allIds).toContain(user2);
    });

    it('should return empty array when no joined participants', () => {
      service.createEvent(chatId, 'Test Event', 5, adminId);
      const event = db.getActiveEvent(chatId)!;

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(0);
    });
  });
});
