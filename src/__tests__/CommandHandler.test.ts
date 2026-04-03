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
});
