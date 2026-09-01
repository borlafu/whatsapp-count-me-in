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
      service.joinEvent(chatId, user2, 'User Two'); // Waitlisted via !join

      const result = service.leaveEvent(chatId, user1);
      expect(result.success).toBe(true);
      expect((result as any).promotion).toBeDefined();
      expect((result as any).promotion.userId).toBe(user2);
    });

    it('should NOT auto-promote a user who explicitly used !waitlist when someone leaves', () => {
      service.createEvent(chatId, 'Test Event', 1, adminId);
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two', true); // forceWaitlist = !waitlist command

      const result = service.leaveEvent(chatId, user1);
      expect(result.success).toBe(true);
      expect((result as any).promotion).toBeUndefined();
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

  describe('post-lock flow', () => {
    it('should allow pending_promotion user to confirm after lock', () => {
      service.createEvent(chatId, 'Test Event', 1, adminId);
      const event = db.getActiveEvent(chatId)!;
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two');
      db.setGroupsTriggered(event.id);
      service.leaveEvent(chatId, user1);
      const result = service.joinEvent(chatId, user2, 'User Two');
      expect(result.success).toBe(true);
      expect(result.messageKey).toBe('confirmedSpot');
      expect(result.groupsUpdated).toBe(true);
    });

    it('should still block new joins after lock', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const event = db.getActiveEvent(chatId)!;
      service.joinEvent(chatId, user1, 'User One');
      db.setGroupsTriggered(event.id);
      const result = service.joinEvent(chatId, user2, 'User Two');
      expect(result.success).toBe(false);
      expect(result.messageKey).toBe('registrationsClosed');
    });

    it('should block leave on locked event when no waitlist', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const event = db.getActiveEvent(chatId)!;
      service.joinEvent(chatId, user1, 'User One');
      db.setGroupsTriggered(event.id);
      const result = service.leaveEvent(chatId, user1);
      expect(result.success).toBe(false);
      expect(result.messageKey).toBe('leaveLockedNoWaitlist');
    });

    it('should allow leave on locked event when waitlist has someone', () => {
      service.createEvent(chatId, 'Test Event', 1, adminId);
      const event = db.getActiveEvent(chatId)!;
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two');
      db.setGroupsTriggered(event.id);
      const result = service.leaveEvent(chatId, user1);
      expect(result.success).toBe(true);
      expect(result.promotion).toBeDefined();
      expect(result.promotion!.userId).toBe(user2);
    });

    it('should allow leave on non-locked event even with no waitlist', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      service.joinEvent(chatId, user1, 'User One');
      const result = service.leaveEvent(chatId, user1);
      expect(result.success).toBe(true);
    });

    it('should allow pending_promotion user to decline (!leave) after lock and promote next', () => {
      const user3 = 'user3@s.whatsapp.net';
      service.createEvent(chatId, 'Test Event', 1, adminId);
      const event = db.getActiveEvent(chatId)!;
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two');
      service.joinEvent(chatId, user3, 'User Three');
      db.setGroupsTriggered(event.id);
      service.leaveEvent(chatId, user1);           // promotes user2 to pending_promotion
      const result = service.leaveEvent(chatId, user2); // user2 declines
      expect(result.success).toBe(true);
      const participants = db.getParticipants(event.id);
      expect(participants.find(p => p.user_id === user2)).toBeUndefined(); // withdrawn
      expect(participants.find(p => p.user_id === user3)?.status).toBe('pending_promotion');
    });
  });

  describe('Duplicate Participant Bug - Leave/Rejoin/Promote Scenarios', () => {
    it('should not create duplicate participants when user leaves, rejoins, and gets promoted', () => {
      // Create event with 1 slot
      service.createEvent(chatId, 'Test Event', 1, adminId);
      const event = db.getActiveEvent(chatId)!;

      // User1 joins (fills the slot)
      service.joinEvent(chatId, user1, 'User One');

      // User1 leaves
      service.leaveEvent(chatId, user1);

      // User1 rejoins (goes to waitlist because user2 will fill the slot)
      service.joinEvent(chatId, user2, 'User Two');
      service.joinEvent(chatId, user1, 'User One'); // Now on waitlist

      // User2 leaves (should promote user1)
      service.leaveEvent(chatId, user2);

      // Verify user1 appears only ONCE in participants
      const participants = db.getParticipants(event.id);
      const user1Records = participants.filter(p => p.user_id === user1);
      expect(user1Records).toHaveLength(1);
      expect(user1Records[0].status).toBe('pending_promotion');
    });

    it('should handle multiple leave/rejoin cycles correctly', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const event = db.getActiveEvent(chatId)!;

      // Cycle 1: join -> leave
      service.joinEvent(chatId, user1, 'User One');
      service.leaveEvent(chatId, user1);

      // Cycle 2: join -> leave
      service.joinEvent(chatId, user1, 'User One');
      service.leaveEvent(chatId, user1);

      // Cycle 3: join (stays)
      service.joinEvent(chatId, user1, 'User One');

      // Verify only one active record
      const participants = db.getParticipants(event.id);
      const user1Records = participants.filter(p => p.user_id === user1);
      expect(user1Records).toHaveLength(1);
      expect(user1Records[0].status).toBe('joined');
    });

    it('should not affect withdrawn records when updating status', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const event = db.getActiveEvent(chatId)!;

      // User1 joins and leaves (creates withdrawn record)
      service.joinEvent(chatId, user1, 'User One');
      service.leaveEvent(chatId, user1);

      // User1 rejoins
      service.joinEvent(chatId, user1, 'User One');

      // Get all records including withdrawn
      const allRecords = (db as any).db.prepare('SELECT * FROM participants WHERE event_id = ? AND user_id = ? ORDER BY joined_at ASC').all(event.id, user1);
      expect(allRecords).toHaveLength(2);
      expect(allRecords[0].status).toBe('withdrawn'); // First record still withdrawn
      expect(allRecords[1].status).toBe('joined'); // Second record is active
    });

    it('should correctly demote and promote users who have rejoined after leaving', () => {
      service.createEvent(chatId, 'Test Event', 3, adminId);
      const event = db.getActiveEvent(chatId)!;
      const user3 = 'user3@s.whatsapp.net';

      // All users join
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two');
      service.joinEvent(chatId, user3, 'User Three');

      // User2 leaves and rejoins
      service.leaveEvent(chatId, user2);
      service.joinEvent(chatId, user2, 'User Two');

      // Resize down to 1 slot (should demote user2 and user3)
      service.resizeEvent(chatId, 1);

      let participants = db.getParticipants(event.id);
      let user2Records = participants.filter(p => p.user_id === user2);
      expect(user2Records).toHaveLength(1);
      expect(user2Records[0].status).toBe('waitlisted');

      // Resize up to 3 slots (should promote user2 back)
      service.resizeEvent(chatId, 3);

      participants = db.getParticipants(event.id);
      user2Records = participants.filter(p => p.user_id === user2);
      expect(user2Records).toHaveLength(1);
      expect(user2Records[0].status).toBe('joined');
    });

    it('should correctly confirm pending promotion for users who previously left and rejoined', () => {
      service.createEvent(chatId, 'Test Event', 1, adminId);
      const event = db.getActiveEvent(chatId)!;

      // User1 joins, leaves, rejoins (waitlisted)
      service.joinEvent(chatId, user2, 'User Two');
      service.joinEvent(chatId, user1, 'User One');
      service.leaveEvent(chatId, user1);
      service.joinEvent(chatId, user1, 'User One'); // Waitlisted

      // User2 leaves (promotes user1 to pending_promotion)
      service.leaveEvent(chatId, user2);

      // User1 confirms by calling join again
      service.joinEvent(chatId, user1, 'User One');

      // Verify only one 'joined' record exists
      const participants = db.getParticipants(event.id);
      const user1Records = participants.filter(p => p.user_id === user1);
      expect(user1Records).toHaveLength(1);
      expect(user1Records[0].status).toBe('joined');
    });

    it('getParticipants should never return duplicate user_ids', () => {
      service.createEvent(chatId, 'Test Event', 3, adminId);
      const event = db.getActiveEvent(chatId)!;
      const user3 = 'user3@s.whatsapp.net';

      // Complex scenario: multiple users with leave/rejoin cycles
      service.joinEvent(chatId, user1, 'User One');
      service.joinEvent(chatId, user2, 'User Two');
      service.leaveEvent(chatId, user1);
      service.joinEvent(chatId, user3, 'User Three');
      service.joinEvent(chatId, user1, 'User One'); // Waitlisted
      service.leaveEvent(chatId, user2);
      service.joinEvent(chatId, user2, 'User Two'); // Promoted from waitlist

      // Verify no duplicate user_ids
      const participants = db.getParticipants(event.id);
      const userIds = participants.map(p => p.user_id);
      const uniqueUserIds = new Set(userIds);
      expect(userIds.length).toBe(uniqueUserIds.size);
    });
  });

  describe('concludeEvent', () => {
    it('should conclude an active event and return eventConcluded', () => {
      service.createEvent(chatId, 'Padel', 10, adminId);
      const result = service.concludeEvent(chatId);
      expect(result.success).toBe(true);
      expect(result.messageKey).toBe('eventConcluded');
      expect(result.params).toEqual(['Padel']);
      expect(db.getActiveEvent(chatId)).toBeUndefined();
    });

    it('should return noActiveEventConclude when no active event', () => {
      const result = service.concludeEvent(chatId);
      expect(result.success).toBe(false);
      expect(result.messageKey).toBe('noActiveEventConclude');
    });
  });
});

describe('EventService participation cheers', () => {
  let db: DatabaseManager;
  let service: EventService;

  const chatId = 'cheers@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const userId = 'user1@s.whatsapp.net';

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    service = new EventService(db);
  });

  /** Records a concluded past event, optionally with the user attending. */
  function pastEvent(attended: boolean, weekOffset: number) {
    const eventAt = new Date(Date.UTC(2026, 0, 1) + weekOffset * 7 * 24 * 60 * 60 * 1000).toISOString();
    const eventId = Number(db.createEvent(chatId, `Week ${weekOffset}`, 10, true, adminId, eventAt, 'UTC'));
    if (attended) db.addParticipant(eventId, userId, 'User One', 'joined');
    db.concludeEvent(eventId);
  }

  it('welcomes a first timer', () => {
    service.createEvent(chatId, 'Test Event', 5, adminId);
    const result = service.joinEvent(chatId, userId, 'User One');
    expect(result.cheer?.messageKey).toBe('cheerFirstTime');
    expect(result.cheer?.mentions).toEqual([userId]);
  });

  it('celebrates a third consecutive join', () => {
    pastEvent(true, 0);
    pastEvent(true, 1);
    service.createEvent(chatId, 'Test Event', 5, adminId);
    const result = service.joinEvent(chatId, userId, 'User One');
    expect(result.cheer?.messageKey).toBe('cheerStreak');
    expect(result.cheer?.params[1]).toBe(3);
  });

  it('stays silent on a fourth consecutive join', () => {
    pastEvent(true, 0);
    pastEvent(true, 1);
    pastEvent(true, 2);
    service.createEvent(chatId, 'Test Event', 5, adminId);
    expect(service.joinEvent(chatId, userId, 'User One').cheer).toBeUndefined();
  });

  it('welcomes back a user who missed three events', () => {
    pastEvent(true, 0);
    pastEvent(false, 1);
    pastEvent(false, 2);
    pastEvent(false, 3);
    service.createEvent(chatId, 'Test Event', 5, adminId);
    const result = service.joinEvent(chatId, userId, 'User One');
    expect(result.cheer?.messageKey).toBe('cheerComeback');
  });

  it('does not cheer a waitlist signup', () => {
    service.createEvent(chatId, 'Test Event', 1, adminId);
    service.joinEvent(chatId, 'other@s.whatsapp.net', 'Other');
    const result = service.joinEvent(chatId, userId, 'User One');
    expect(result.messageKey).toBe('joinedWaitlist');
    expect(result.cheer).toBeUndefined();
  });

  it('cheers when a waitlisted user later confirms a freed spot', () => {
    const other = 'other@s.whatsapp.net';
    service.createEvent(chatId, 'Test Event', 1, adminId);
    service.joinEvent(chatId, other, 'Other');
    service.joinEvent(chatId, userId, 'User One');
    service.leaveEvent(chatId, other);

    const result = service.joinEvent(chatId, userId, 'User One');
    expect(result.messageKey).toBe('confirmedSpot');
    expect(result.cheer?.messageKey).toBe('cheerFirstTime');
  });

  it('does not cheer invited guests, who have no history of their own', () => {
    service.createEvent(chatId, 'Test Event', 5, adminId);
    const result = service.inviteGuest(chatId, adminId, 'Admin', 'Guest Name');
    expect(result.success).toBe(true);
    expect(result.cheer).toBeUndefined();
  });

  it('ignores history from other groups', () => {
    const otherChat = 'elsewhere@g.us';
    const otherEventId = Number(db.createEvent(otherChat, 'Elsewhere', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(otherEventId, userId, 'User One', 'joined');
    db.concludeEvent(otherEventId);

    service.createEvent(chatId, 'Test Event', 5, adminId);
    expect(service.joinEvent(chatId, userId, 'User One').cheer?.messageKey).toBe('cheerFirstTime');
  });

  it('warns about the streak lost when withdrawing', () => {
    pastEvent(true, 0);
    service.createEvent(chatId, 'Test Event', 5, adminId);
    service.joinEvent(chatId, userId, 'User One');

    const result = service.leaveEvent(chatId, userId);
    expect(result.success).toBe(true);
    expect(result.streakLoss).toEqual({ userId, streak: 2 });
  });

  it('does not warn when there is no streak worth losing', () => {
    service.createEvent(chatId, 'Test Event', 5, adminId);
    service.joinEvent(chatId, userId, 'User One');
    expect(service.leaveEvent(chatId, userId).streakLoss).toBeUndefined();
  });

  it('does not warn a withdrawing guest about streaks', () => {
    service.createEvent(chatId, 'Test Event', 5, adminId);
    service.inviteGuest(chatId, adminId, 'Admin', 'Guest Name');
    const result = service.leaveByIndex(chatId, adminId, true, 1);
    expect(result.success).toBe(true);
    expect(result.streakLoss).toBeUndefined();
  });
});

describe('EventService cheer fixes from review', () => {
  let db: DatabaseManager;
  let service: EventService;

  const chatId = 'fixes@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const userId = 'user1@s.whatsapp.net';
  const otherId = 'user2@s.whatsapp.net';

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    service = new EventService(db);
  });

  function pastEvent(attended: boolean, weekOffset: number, who = userId) {
    const eventAt = new Date(Date.UTC(2026, 0, 1) + weekOffset * 7 * 24 * 60 * 60 * 1000).toISOString();
    const eventId = Number(db.createEvent(chatId, `Week ${weekOffset}`, 10, true, adminId, eventAt, 'UTC'));
    if (attended) db.addParticipant(eventId, who, who, 'joined');
    db.concludeEvent(eventId);
  }

  it('does not repeat the cheer when a user rejoins the same event', () => {
    pastEvent(true, 0);
    pastEvent(true, 1);
    service.createEvent(chatId, 'Test Event', 5, adminId);

    expect(service.joinEvent(chatId, userId, 'User One').cheer?.messageKey).toBe('cheerStreak');
    service.leaveEvent(chatId, userId);
    expect(service.joinEvent(chatId, userId, 'User One').cheer).toBeUndefined();
  });

  it('does not repeat the first-timer welcome when a user rejoins', () => {
    service.createEvent(chatId, 'Test Event', 5, adminId);
    expect(service.joinEvent(chatId, userId, 'User One').cheer?.messageKey).toBe('cheerFirstTime');
    service.leaveEvent(chatId, userId);
    expect(service.joinEvent(chatId, userId, 'User One').cheer).toBeUndefined();
  });

  it('still cheers a different user after someone else rejoins', () => {
    service.createEvent(chatId, 'Test Event', 5, adminId);
    service.joinEvent(chatId, userId, 'User One');
    service.leaveEvent(chatId, userId);
    service.joinEvent(chatId, userId, 'User One');

    expect(service.joinEvent(chatId, otherId, 'User Two').cheer?.messageKey).toBe('cheerFirstTime');
  });

  it('warns the user about their own streak when they leave by index', () => {
    pastEvent(true, 0);
    service.createEvent(chatId, 'Test Event', 5, adminId);
    service.joinEvent(chatId, userId, 'User One');

    const result = service.leaveByIndex(chatId, userId, false, 1);
    expect(result.streakLoss).toEqual({ userId, streak: 2 });
  });

  it('does not warn a member that an admin removed', () => {
    pastEvent(true, 0);
    service.createEvent(chatId, 'Test Event', 5, adminId);
    service.joinEvent(chatId, userId, 'User One');

    const result = service.leaveByIndex(chatId, adminId, true, 1);
    expect(result.success).toBe(true);
    expect(result.streakLoss).toBeUndefined();
  });
});
