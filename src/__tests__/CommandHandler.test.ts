import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandler } from '../CommandHandler.js';
import { EventService } from '../EventService.js';
import { DatabaseManager } from '../Database.js';

// Mocking the Baileys types and utilities
vi.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (jid: string) => jid.split(':')[0] || jid
}));

describe('CommandHandler', () => {
  let db: DatabaseManager;
  let service: EventService;
  let handler: CommandHandler;

  const chatId = '12345@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const userId = 'user@s.whatsapp.net';

  const mockSock: any = {
    user: { id: adminId },
    groupMetadata: vi.fn(),
    sendMessage: vi.fn()
  };

  const createMockMsg = (text: string, fromMe = false, participant = userId): any => ({
    key: {
      remoteJid: chatId,
      fromMe,
      participant
    },
    message: {
      conversation: text
    },
    pushName: 'Test User'
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db = new DatabaseManager(':memory:');
    service = new EventService(db);
    handler = new CommandHandler(service, db);
  });

  it('should ignore messages that do not start with !', async () => {
    const msg = createMockMsg('Hello bot');
    await handler.handleCommand(msg, mockSock);
    expect(mockSock.sendMessage).not.toHaveBeenCalled();
  });

  it('should show help message for !help', async () => {
    const msg = createMockMsg('!help');
    await handler.handleCommand(msg, mockSock);
    expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
      text: expect.stringContaining('Count Me In')
    }), expect.anything());
  });

  describe('!create', () => {
    it('should allow admin to create an event', async () => {
      mockSock.groupMetadata.mockResolvedValue({
        participants: [{ id: adminId, admin: 'admin' }]
      });

      const msg = createMockMsg('!create "My Party" 10', true, adminId);
      await handler.handleCommand(msg, mockSock);

      const activeEvent = db.getActiveEvent(chatId);
      expect(activeEvent?.title).toBe('My Party');
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Party')
      }), expect.anything());
    });

    it('should support macOS/iOS curly quotes (smart quotes)', async () => {
      mockSock.groupMetadata.mockResolvedValue({
        participants: [{ id: adminId, admin: 'admin' }]
      });

      const msg = createMockMsg('!create “La hostia” 67', true, adminId);
      await handler.handleCommand(msg, mockSock);

      const activeEvent = db.getActiveEvent(chatId);
      expect(activeEvent?.title).toBe('La hostia');
      expect(activeEvent?.slots).toBe(67);
    });

    it('should deny non-admin from creating an event', async () => {
      mockSock.groupMetadata.mockResolvedValue({
        participants: [{ id: userId, admin: null }]
      });

      const msg = createMockMsg('!create "My Party" 10');
      await handler.handleCommand(msg, mockSock);

      const activeEvent = db.getActiveEvent(chatId);
      expect(activeEvent).toBeUndefined();
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Only group admins')
      }), expect.anything());
    });
  });

  describe('!join', () => {
    it('should call EventService.joinEvent and reply', async () => {
      service.createEvent(chatId, 'My Party', 2, adminId);
      const msg = createMockMsg('!join');
      await handler.handleCommand(msg, mockSock);

      const participants = db.getParticipants(db.getActiveEvent(chatId)!.id);
      expect(participants.length).toBe(1);
      expect(mockSock.sendMessage).toHaveBeenCalled();
    });
  });

  describe('!rename', () => {
    it('should deny non-admin', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: userId, admin: null }] });
      service.createEvent(chatId, 'Old Name', 5, adminId);
      await handler.handleCommand(createMockMsg('!rename "New Name"'), mockSock);
      expect(db.getActiveEvent(chatId)?.title).toBe('Old Name');
    });

    it('should reply with usage when no title given', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Old Name', 5, adminId);
      await handler.handleCommand(createMockMsg('!rename', true, adminId), mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('!rename')
      }), expect.anything());
    });

    it('should allow admin to rename the event', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Old Name', 5, adminId);
      await handler.handleCommand(createMockMsg('!rename "New Name"', true, adminId), mockSock);
      expect(db.getActiveEvent(chatId)?.title).toBe('New Name');
    });

    it('should support curly quotes', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Old Name', 5, adminId);
      await handler.handleCommand(createMockMsg('!rename \u201cFiesta Grande\u201d', true, adminId), mockSock);
      expect(db.getActiveEvent(chatId)?.title).toBe('Fiesta Grande');
    });
  });

  describe('!resize', () => {
    it('should deny non-admin', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: userId, admin: null }] });
      service.createEvent(chatId, 'Party', 5, adminId);
      await handler.handleCommand(createMockMsg('!resize 3'), mockSock);
      expect(db.getActiveEvent(chatId)?.slots).toBe(5);
    });

    it('should reply with usage when no number given', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 5, adminId);
      await handler.handleCommand(createMockMsg('!resize', true, adminId), mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('!resize')
      }), expect.anything());
    });

    it('should allow admin to update slots', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 5, adminId);
      await handler.handleCommand(createMockMsg('!resize 10', true, adminId), mockSock);
      expect(db.getActiveEvent(chatId)?.slots).toBe(10);
    });

    it('should demote excess participants when slots reduced', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 3, adminId);
      service.joinEvent(chatId, 'u1@s.whatsapp.net', 'U1');
      service.joinEvent(chatId, 'u2@s.whatsapp.net', 'U2');
      service.joinEvent(chatId, 'u3@s.whatsapp.net', 'U3');
      await handler.handleCommand(createMockMsg('!resize 1', true, adminId), mockSock);
      const event = db.getActiveEvent(chatId)!;
      expect(db.getParticipants(event.id).filter(p => p.status === 'joined').length).toBe(1);
      expect(db.getParticipants(event.id).filter(p => p.status === 'waitlisted').length).toBe(2);
    });
  });

  describe('!invite', () => {
    it('should allow a user to invite a guest', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      const msg = createMockMsg('!invite "Guest Name"');
      await handler.handleCommand(msg, mockSock);

      const event = db.getActiveEvent(chatId)!;
      const participants = db.getParticipants(event.id);
      const guest = participants.find(p => p.user_name === 'Guest Name')!;
      
      expect(guest).toBeDefined();
      expect(guest.user_id).toContain('guest:');
      expect(guest.invited_by).toBe(userId);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Guest Name')
      }), expect.anything());
    });

    it('should format guest names correctly in status', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      await handler.handleCommand(createMockMsg('!invite "Juan"'), mockSock);
      
      // Clear mock to check status call
      mockSock.sendMessage.mockClear();
      await handler.handleCommand(createMockMsg('!status'), mockSock);

      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining("Juan (Test User's guest)")
      }), expect.anything());
    });

    it('should add guest to waitlist if full', async () => {
      service.createEvent(chatId, 'Party', 1, adminId);
      service.joinEvent(chatId, adminId, 'Admin');
      
      const msg = createMockMsg('!invite "Guest"');
      await handler.handleCommand(msg, mockSock);

      const event = db.getActiveEvent(chatId)!;
      const guest = db.getParticipants(event.id).find(p => p.user_name === 'Guest')!;
      expect(guest.status).toBe('waitlisted');
    });
  });

  describe('!leave with index', () => {
    it('should allow a user to remove themselves by index', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      service.joinEvent(chatId, userId, 'Test User');
      
      const msg = createMockMsg('!leave 1');
      await handler.handleCommand(msg, mockSock);

      const event = db.getActiveEvent(chatId)!;
      expect(db.getParticipants(event.id).length).toBe(0);
    });

    it('should allow a user to remove their own guest', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      service.joinEvent(chatId, userId, 'Test User');
      service.inviteGuest(chatId, userId, 'Test User', 'Guest');
      
      // Status will be: 1. Test User, 2. Guest
      const msg = createMockMsg('!leave 2');
      await handler.handleCommand(msg, mockSock);

      const event = db.getActiveEvent(chatId)!;
      const participants = db.getParticipants(event.id);
      expect(participants.length).toBe(1);
      expect(participants[0]?.user_name).toBe('Test User');
    });

    it('should allow admin to remove anyone', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      service.joinEvent(chatId, userId, 'User');
      
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      const msg = createMockMsg('!leave 1', true, adminId);
      await handler.handleCommand(msg, mockSock);

      const event = db.getActiveEvent(chatId)!;
      expect(db.getParticipants(event.id).length).toBe(0);
    });

    it('should deny non-admin from removing someone else', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      service.joinEvent(chatId, adminId, 'Admin');
      
      const msg = createMockMsg('!leave 1'); // User trying to remove Admin at index 1
      await handler.handleCommand(msg, mockSock);

      const event = db.getActiveEvent(chatId)!;
      expect(db.getParticipants(event.id).length).toBe(1);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('only remove yourself or your own guests')
      }), expect.anything());
    });

    it('should handle invalid index', async () => {
      service.createEvent(chatId, 'Party', 5, adminId);
      const msg = createMockMsg('!leave 99');
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Invalid number')
      }), expect.anything());
    });
  });

  describe('!groups', () => {
    it('should deny non-admin', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: userId, admin: null }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      await handler.handleCommand(createMockMsg('!groups'), mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Only group admins')
      }), expect.anything());
    });

    it('should show error when no active event', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      const msg = createMockMsg('!groups', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('No active event')
      }), expect.anything());
    });

    it('should show error when fewer than 2 joined participants', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      service.joinEvent(chatId, userId, 'User');
      const msg = createMockMsg('!groups', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('at least 2')
      }), expect.anything());
    });

    it('should show error for invalid group size', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      const msg = createMockMsg('!groups abc', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('must be a number')
      }), expect.anything());
    });

    it('should show error for group size less than 2', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      const msg = createMockMsg('!groups 1', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('must be a number')
      }), expect.anything());
    });

    it('should default to groups of 4', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      for (let i = 1; i <= 8; i++) {
        service.joinEvent(chatId, `u${i}@s.whatsapp.net`, `User ${i}`);
      }
      const msg = createMockMsg('!groups', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringMatching(/Random Groups \(of 4\)/)
      }), expect.anything());
    });

    it('should accept custom group size', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      for (let i = 1; i <= 6; i++) {
        service.joinEvent(chatId, `u${i}@s.whatsapp.net`, `User ${i}`);
      }
      const msg = createMockMsg('!groups 3', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringMatching(/Random Groups \(of 3\)/)
      }), expect.anything());
    });

    it('should display group labels and participant names', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      service.joinEvent(chatId, 'u1@s.whatsapp.net', 'Alice');
      service.joinEvent(chatId, 'u2@s.whatsapp.net', 'Bob');
      service.joinEvent(chatId, 'u3@s.whatsapp.net', 'Carol');
      const msg = createMockMsg('!groups 2', true, adminId);
      await handler.handleCommand(msg, mockSock);
      const sentText = mockSock.sendMessage.mock.calls[0][1].text;
      expect(sentText).toContain('Group 1:');
      expect(sentText).toContain('Group 2:');
    });

    it('should work with Spanish alias !sorteo', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Fiesta', 10, adminId);
      service.joinEvent(chatId, 'u1@s.whatsapp.net', 'Alice');
      service.joinEvent(chatId, 'u2@s.whatsapp.net', 'Bob');
      const msg = createMockMsg('!sorteo', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Group')
      }), expect.anything());
    });
  });
});
