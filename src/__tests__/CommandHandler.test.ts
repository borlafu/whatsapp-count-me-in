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
});
