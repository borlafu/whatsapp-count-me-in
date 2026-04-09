import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import type { DatabaseManager } from './Database.js';
import { t, type Locale } from './i18n.js';
import { CommandParser } from './CommandParser.js';
import type { EventService } from './EventService.js';

export class CommandHandler {
  constructor(
    private eventService: EventService,
    private db: DatabaseManager
  ) {}

  async handleCommand(msg: WAMessage, sock: WASocket) {
    try {
      if (!msg.key) return;
      const chatId = msg.key.remoteJid;
      if (!chatId || !chatId.endsWith('@g.us')) return;

      let senderId = msg.key.participant;
      if (msg.key.fromMe) {
        senderId = sock.user?.id;
      }
      if (!senderId) return;

      senderId = jidNormalizedUser(senderId);
      const userName: string = msg.pushName || senderId.split('@')[0] || 'Unknown';
      const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
      if (!body.startsWith('!')) return;

      const { action, args } = CommandParser.parse(body);
      if (!action) return;

      const locale = this.db.getLocale(chatId);

      switch (action) {
        case 'create':
          await this.handleCreate(msg, chatId, senderId, args, sock, locale);
          break;
        case 'join':
          await this.handleJoin(msg, chatId, senderId, userName, sock, locale, false);
          break;
        case 'waitlist':
          await this.handleJoin(msg, chatId, senderId, userName, sock, locale, true);
          break;
        case 'leave':
          await this.handleLeave(msg, chatId, senderId, args, sock, locale);
          break;
        case 'status':
          await this.handleStatus(msg, chatId, sock, locale);
          break;
        case 'cancel':
          await this.handleCancel(msg, chatId, senderId, sock, locale);
          break;
        case 'resize':
          await this.handleResize(msg, chatId, senderId, args, sock, locale);
          break;
        case 'rename':
          await this.handleRename(msg, chatId, senderId, args, sock, locale);
          break;
        case 'invite':
          await this.handleInvite(msg, chatId, senderId, userName, args, sock, locale);
          break;
        case 'lang':
          await this.handleLang(msg, chatId, senderId, args, sock, locale);
          break;
        case 'groups':
          await this.handleGroups(msg, chatId, senderId, args, sock, locale);
          break;
        case 'help':
          await this.safeReply(msg, chatId, sock, t(locale, 'helpMessage'));
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('Error in handleCommand:', err);
    }
  }

  private async isAdmin(chatId: string, userId: string, sock: WASocket): Promise<boolean> {
    if (!chatId.endsWith('@g.us')) return true;
    try {
      const metadata = await sock.groupMetadata(chatId);
      const participant = metadata.participants.find(p => p.id === userId);
      return !!(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
    } catch (e) {
      return false;
    }
  }

  private async handleLang(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const newLang = args[0]?.toLowerCase();
    if (!newLang || (newLang !== 'en' && newLang !== 'es')) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'langUsage'));
    }
    this.db.setLocale(chatId, newLang as Locale);
    await this.safeReply(msg, chatId, sock, t(newLang as Locale, 'langChanged', newLang));
  }

  private async handleCreate(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const title = (args[0] ?? "").trim().substring(0, 100);
    const slots = parseInt(args[1] ?? "0");
    if (!title || slots <= 0) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'createUsage'));
    }

    const result = this.eventService.createEvent(chatId, title, slots, userId);
    await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
  }

  private async handleJoin(msg: WAMessage, chatId: string, userId: string, userName: string, sock: WASocket, locale: Locale, forceWaitlist: boolean) {
    const result = this.eventService.joinEvent(chatId, userId, userName, forceWaitlist);
    if (!result.success && result.messageKey === 'noActiveEvent') {
      return await this.safeReply(msg, chatId, sock, t(locale, 'noActiveEvent'));
    }

    if (result.showStatus) {
      await this.handleStatus(msg, chatId, sock, locale);
    } else {
      await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
    }
  }

  private async handleInvite(msg: WAMessage, chatId: string, userId: string, userName: string, args: string[], sock: WASocket, locale: Locale) {
    const guestName = (args[0] ?? '').trim().substring(0, 50);
    if (!guestName) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'inviteUsage'));
    }
 
    const result = this.eventService.inviteGuest(chatId, userId, userName, guestName);

    if (result.showStatus) {
      await this.handleStatus(msg, chatId, sock, locale);
    } else {
      await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
    }
  }

  private async handleLeave(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    const index = parseInt(args[0] ?? '');
    let result;

    if (!isNaN(index) && index > 0) {
      const isAdmin = await this.isAdmin(chatId, userId, sock);
      result = this.eventService.leaveByIndex(chatId, userId, isAdmin, index);
    } else {
      result = this.eventService.leaveEvent(chatId, userId);
    }

    if (!result.success) {
      if (result.messageKey) await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any));
      return;
    }

    const options: { mentions?: string[] } = {};
    if (result.mentions) options.mentions = result.mentions;

    if (result.promotion) {
      const p = result.promotion;
      await sock.sendMessage(chatId, {
        text: t(locale, 'slotOpened', p.userId.split('@')[0] ?? '', p.eventTitle),
        mentions: [p.userId]
      });
    }

    if (result.showStatus) {
      await this.handleStatus(msg, chatId, sock, locale);
    } else {
      await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])), options);
    }
  }

  private async handleRename(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const newTitle = (args[0] ?? '').trim().substring(0, 100);
    if (!newTitle) return await this.safeReply(msg, chatId, sock, t(locale, 'renameUsage'));
    const result = this.eventService.renameEvent(chatId, newTitle);
    await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
  }

  private async handleResize(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const newSlots = parseInt(args[0] ?? '');
    if (!newSlots || newSlots <= 0) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'resizeUsage'));
    }
    const result = this.eventService.resizeEvent(chatId, newSlots);
    await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
    if (result.showStatus) await this.handleStatus(msg, chatId, sock, locale);
  }

  private async handleCancel(msg: WAMessage, chatId: string, userId: string, sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const result = this.eventService.cancelEvent(chatId);
    await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
  }

  private async handleGroups(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }

    const event = this.db.getActiveEvent(chatId);
    if (!event) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'noActiveEvent'));
    }

    let membersPerGroup = 4;
    if (args[0]) {
      membersPerGroup = parseInt(args[0]);
      if (isNaN(membersPerGroup) || membersPerGroup < 2) {
        return await this.safeReply(msg, chatId, sock, t(locale, 'groupsInvalidSize'));
      }
    }

    const groups = this.eventService.makeGroups(event.id, membersPerGroup);
    const totalParticipants = groups.reduce((sum, g) => sum + g.length, 0);

    if (totalParticipants < 2) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'groupsNotEnough'));
    }

    let text = `${t(locale, 'groupsHeader', membersPerGroup)}\n`;
    groups.forEach((group, i) => {
      text += `\n${t(locale, 'groupLabel', i + 1)}\n`;
      group.forEach(p => {
        const displayName = p.invited_by
          ? t(locale, 'statusGuest', p.user_name, p.invited_by_name || 'Admin')
          : p.user_name;
        text += `- ${displayName}\n`;
      });
    });

    await this.safeReply(msg, chatId, sock, text);
  }

  private async handleStatus(msg: WAMessage, chatId: string, sock: WASocket, locale: Locale) {
    const result = this.eventService.getStatus(chatId);
    if (!result.success) {
      return await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any));
    }
    const data = result.data!;
    const joined = data.participants.filter((p: any) => p.status === 'joined' || p.status === 'pending_promotion');
    const waitlisted = data.participants.filter((p: any) => p.status === 'waitlisted');

    let text = `${t(locale, 'statusHeader', data.title)}\n`;
    text += `${t(locale, 'statusSlots', joined.length, data.slots)}\n\n`;
    text += `${t(locale, 'statusParticipants')}\n`;
    joined.forEach((p: any, i: number) => {
      const displayName = p.invited_by ? t(locale, 'statusGuest', p.user_name, p.invited_by_name || 'Admin') : p.user_name;
      text += `${i + 1}. ${displayName} ${p.status === 'pending_promotion' ? t(locale, 'statusPendingTag') : ''}\n`;
    });
    if (waitlisted.length > 0) {
      text += `\n${t(locale, 'statusWaitlist')}\n`;
      waitlisted.forEach((p: any, i: number) => {
        const displayName = p.invited_by ? t(locale, 'statusGuest', p.user_name, p.invited_by_name || 'Admin') : p.user_name;
        text += `${i + 1}. ${displayName}\n`;
      });
    }
    await this.safeReply(msg, chatId, sock, text);
  }

  private async safeReply(msg: WAMessage, chatId: string, sock: WASocket, text: string, options: { mentions?: string[] } = {}) {
    try {
      await sock.sendMessage(chatId, { text, mentions: options.mentions || [] }, { quoted: msg as WAMessage });
    } catch (err: any) {
      await sock.sendMessage(chatId, { text, mentions: options.mentions || [] });
    }
  }
}
