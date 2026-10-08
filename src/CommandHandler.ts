import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import type { DatabaseManager } from './Database.js';
import { t, type Locale, type MessageTemplates } from './i18n.js';
import { CommandParser } from './CommandParser.js';
import { commandSpec } from './commandSpecs.js';
import type { EventService, ServiceResult } from './EventService.js';
import { localToUtc, formatEventDate, formatCountdown, parseOffsetToMinutes, parsePositiveInt, formatGroups } from './formatters.js';
import { collectMemberJids, findParticipant, rememberMemberName, resolveMemberName } from './memberNames.js';

/** One @mention, paired with the display name the sender's client wrote for it. */
interface Mention {
  jid: string;
  isolateName: string | undefined;
}

export class CommandHandler {
  constructor(
    private eventService: EventService,
    private db: DatabaseManager,
    private contactNames: Map<string, string> = new Map()
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
      this.rememberName(msg, senderId);
      const userName: string = msg.pushName || senderId.split('@')[0] || 'Unknown';
      const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const mentionedJids = (contextInfo?.mentionedJid ?? []).map(jidNormalizedUser);
      const quotedAuthor = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : undefined;

      // Ordinary chatter leaves before any parsing: a group sees far more of it
      // than commands, and this bot is built to stay small.
      const couldBeCommand = body.startsWith('!') || mentionedJids.length > 0 || !!quotedAuthor;
      if (!couldBeCommand) return;

      const botJids = collectBotJids(sock);
      const parsed = CommandParser.parse(body, { botJids, mentionedJids, quotedAuthor });

      if (parsed.unknown) {
        const unknownLocale = this.db.getLocale(chatId);
        return await this.safeReply(msg, chatId, sock, t(unknownLocale, 'unknownCommand', parsed.unknown.typed, parsed.unknown.suggestion));
      }

      const { action, args } = parsed;
      if (!action) return;

      const locale = this.db.getLocale(chatId);
      // The bot's own mention addresses it; it is never a target of a command.
      const mentions = collectMentions(msg, mentionedJids, botJids);

      const spec = commandSpec(action);
      if (spec) {
        const typed = spec.mentionDriven && mentions.length > 0 ? [] : args;
        if (typed.length > spec.maxArgs) {
          const extra = typed.slice(spec.maxArgs).join(' ');
          return await this.safeReply(msg, chatId, sock, t(locale, 'unexpectedArgs', extra, t(locale, spec.usageKey)));
        }
      }

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
          await this.handleLeave(msg, chatId, senderId, args, mentions, sock, locale);
          break;
        case 'status':
          await this.handleStatus(msg, chatId, sock, locale);
          break;
        case 'cancel':
          await this.handleCancel(msg, chatId, senderId, sock, locale);
          break;
        case 'conclude':
          await this.handleConclude(msg, chatId, senderId, sock, locale);
          break;
        case 'resize':
          await this.handleResize(msg, chatId, senderId, args, sock, locale);
          break;
        case 'rename':
          await this.handleRename(msg, chatId, senderId, args, sock, locale);
          break;
        case 'invite':
          await this.handleInvite(msg, chatId, senderId, userName, args, mentions, sock, locale);
          break;
        case 'lang':
          await this.handleLang(msg, chatId, senderId, args, sock, locale);
          break;
        case 'groups':
          await this.handleGroups(msg, chatId, senderId, args, sock, locale);
          break;
        case 'reschedule':
          await this.handleReschedule(msg, chatId, senderId, args, sock, locale);
          break;
        case 'reminders':
          await this.handleReminders(msg, chatId, senderId, args, sock, locale);
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
    const title = (args[0] ?? '').trim().substring(0, 100);
    const slots = parsePositiveInt(args[1]);
    if (!title || slots === null) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'createUsage'));
    }

    // Optional: YYYY-MM-DD HH:MM TZ
    let eventAt: string | undefined;
    let timezone: string | undefined;
    let closeAndGroupOffsetMin: number | undefined;

    if (args[2] && /^\d{4}-\d{2}-\d{2}$/.test(args[2])) {
      const dateStr = args[2]!;
      const timeStr = args[3] ?? '00:00';
      const tz = args[4];
      if (!tz) {
        return await this.safeReply(msg, chatId, sock, t(locale, 'createUsage'));
      }
      const utc = localToUtc(dateStr, timeStr, tz);
      if (!utc) {
        return await this.safeReply(msg, chatId, sock, t(locale, 'createUsage'));
      }
      eventAt = utc;
      timezone = tz;

      // Scan for --close-and-group flag anywhere in remaining args
      const flagIdx = args.indexOf('--close-and-group');
      if (flagIdx !== -1 && args[flagIdx + 1]) {
        const mins = parseOffsetToMinutes(args[flagIdx + 1]!);
        if (mins !== null && mins > 0) closeAndGroupOffsetMin = mins;
      }
    }

    const result = this.eventService.createEvent(chatId, title, slots, userId, eventAt, timezone, closeAndGroupOffsetMin);
    // Render with the locale the service used, not the snapshot taken before
    // the admin lookup awaited, so the whole reply is in one language.
    await this.safeReply(msg, chatId, sock, t(result.locale ?? locale, result.messageKey as any, ...(result.params || [])));
  }

  private async handleReschedule(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const dateStr = args[0];
    const timeStr = args[1];
    const tz = args[2];
    if (!dateStr || !timeStr || !tz || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'rescheduleUsage'));
    }
    const utc = localToUtc(dateStr, timeStr, tz);
    if (!utc) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'rescheduleUsage'));
    }

    let closeAndGroupOffsetMin: number | undefined;
    const flagIdx = args.indexOf('--close-and-group');
    if (flagIdx !== -1 && args[flagIdx + 1]) {
      const mins = parseOffsetToMinutes(args[flagIdx + 1]!);
      if (mins !== null && mins > 0) closeAndGroupOffsetMin = mins;
    }

    const result = this.eventService.rescheduleEvent(chatId, utc, tz, closeAndGroupOffsetMin);
    await this.safeReply(msg, chatId, sock, t(result.locale ?? locale, result.messageKey as any, ...(result.params || [])));
  }

  private async handleReminders(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const val = args[0]?.toLowerCase();
    if (val !== 'on' && val !== 'off') {
      return await this.safeReply(msg, chatId, sock, t(locale, 'remindersUsage'));
    }
    this.db.setRemindersEnabled(chatId, val === 'on');
    await this.safeReply(msg, chatId, sock, t(locale, val === 'on' ? 'remindersOn' : 'remindersOff'));
  }

  private async handleJoin(msg: WAMessage, chatId: string, userId: string, userName: string, sock: WASocket, locale: Locale, forceWaitlist: boolean) {
    await this.executeJoin(msg, chatId, userId, userName, sock, locale, forceWaitlist);
  }

  private async executeJoin(msg: WAMessage, chatId: string, targetUserId: string, targetUserName: string, sock: WASocket, locale: Locale, forceWaitlist: boolean) {
    const result = this.eventService.joinEvent(chatId, targetUserId, targetUserName, forceWaitlist);
    const replyLocale = result.locale ?? locale;
    if (!result.success && result.messageKey === 'noActiveEvent') {
      return await this.safeReply(msg, chatId, sock, t(replyLocale, 'noActiveEvent'));
    }

    if (result.showStatus) {
      await this.handleStatus(msg, chatId, sock, replyLocale);
    } else {
      await this.safeReply(msg, chatId, sock, t(replyLocale, result.messageKey as any, ...(result.params || [])));
    }

    if (result.cheer) {
      await this.sendCheer(chatId, sock, replyLocale, result.cheer.messageKey, result.cheer.params, result.cheer.mentions);
    }

    if (result.groupsUpdated) {
      const event = this.db.getActiveEvent(chatId);
      if (event) {
        const groups = this.eventService.makeGroups(event.id, 4);
        const text = formatGroups(groups, 4, locale, t);
        if (text) await this.safeReply(msg, chatId, sock, text);
      }
    }
  }

  private async handleInvite(msg: WAMessage, chatId: string, userId: string, userName: string, args: string[], mentions: Mention[], sock: WASocket, locale: Locale) {
    if (mentions.length > 0) {
      for (const member of await this.resolveMentions(chatId, mentions, sock)) {
        await this.executeJoin(msg, chatId, member.jid, member.name, sock, locale, false);
      }
      return;
    }

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

  /**
   * Resolves @mentions to every id each member is known by plus their best
   * display name, fetching group metadata once for the whole batch.
   */
  private async resolveMentions(chatId: string, mentions: Mention[], sock: WASocket): Promise<Array<{ jid: string; jids: string[]; name: string }>> {
    const metadata = await sock.groupMetadata(chatId);
    const resolved: Array<{ jid: string; jids: string[]; name: string }> = [];

    for (const mention of mentions) {
      const participant = findParticipant(metadata.participants, mention.jid);
      const jids = await collectMemberJids(mention.jid, participant, sock);
      const name = resolveMemberName(jids, participant, this.contactNames, mention.isolateName);
      resolved.push({ jid: mention.jid, jids, name });
    }

    return resolved;
  }

  /**
   * Remembers the sender's public WhatsApp name under every id they use, so a
   * later @mention invite can name them the same way !join would.
   */
  private rememberName(msg: WAMessage, senderId: string): void {
    if (!msg.pushName) return;
    rememberMemberName(this.contactNames, this.db, senderId, msg.pushName);
    const altId = msg.key?.participantAlt;
    if (altId) rememberMemberName(this.contactNames, this.db, jidNormalizedUser(altId), msg.pushName);
  }

  /**
   * Withdraws someone from the event. The target is whoever the message names:
   * nobody (the sender), a !status number, an @mention, or a name.
   *
   * A name that matches nobody is reported, never treated as "no target": the
   * silent fallback to self-withdrawal is what made "!leave Juanlu" remove the
   * person who typed it.
   */
  private async handleLeave(msg: WAMessage, chatId: string, userId: string, args: string[], mentions: Mention[], sock: WASocket, locale: Locale) {
    const target = args[0];
    if (target === undefined && mentions.length === 0) {
      return await this.replyToWithdrawal(msg, chatId, sock, locale, this.eventService.leaveEvent(chatId, userId));
    }

    const isAdmin = await this.isAdmin(chatId, userId, sock);

    if (mentions.length > 0) {
      for (const member of await this.resolveMentions(chatId, mentions, sock)) {
        const result = this.eventService.leaveByUserIds(chatId, userId, isAdmin, member.jids, member.name);
        await this.replyToWithdrawal(msg, chatId, sock, locale, result);
      }
      return;
    }

    // All digits means a !status number, even an out-of-range one: reporting a
    // bad number beats searching for a participant named "99".
    const result = /^\d+$/.test(target!.trim())
      ? this.eventService.leaveByIndex(chatId, userId, isAdmin, Number(target!.trim()))
      : this.eventService.leaveByName(chatId, userId, isAdmin, target!);
    await this.replyToWithdrawal(msg, chatId, sock, locale, result);
  }

  private async replyToWithdrawal(msg: WAMessage, chatId: string, sock: WASocket, locale: Locale, result: ServiceResult) {
    if (!result.success) {
      if (result.messageKey) {
        await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
      }
      return;
    }

    if (result.promotion) {
      const p = result.promotion;
      await this.sendAside(chatId, sock, t(locale, 'slotOpened', p.userId.split('@')[0] ?? '', p.eventTitle), [p.userId]);
    }

    if (result.showStatus) {
      await this.handleStatus(msg, chatId, sock, locale);
    } else {
      const options: { mentions?: string[] } = {};
      if (result.mentions) options.mentions = result.mentions;
      await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])), options);
    }

    if (result.streakLoss) {
      const loss = result.streakLoss;
      await this.sendCheer(chatId, sock, locale, 'streakLost', [loss.userId.split('@')[0] ?? '', loss.streak], [loss.userId]);
    }
  }

  /**
   * Sends a follow-up message that is not the command's own answer: a cheer, a
   * freed-slot call, a bulk promotion.
   *
   * The command it follows has already been committed to the database, so a
   * failure here is logged and swallowed rather than allowed to abort the rest
   * of the reply — losing the aside is bad, losing the !status that comes after
   * it is worse.
   */
  private async sendAside(chatId: string, sock: WASocket, text: string, mentions: string[]) {
    try {
      await sock.sendMessage(chatId, { text, mentions });
    } catch (err) {
      console.error('Failed to send follow-up message:', err);
    }
  }

  private async sendCheer(chatId: string, sock: WASocket, locale: Locale, messageKey: keyof MessageTemplates, params: any[], mentions: string[]) {
    await this.sendAside(chatId, sock, t(locale, messageKey as any, ...params), mentions);
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
    const newSlots = parsePositiveInt(args[0]);
    if (newSlots === null) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'resizeUsage'));
    }
    const result = this.eventService.resizeEvent(chatId, newSlots);
    await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
    if (result.promotions && result.promotions.length > 0) {
      const mentions = result.promotions.map(p => p.userId);
      const names = result.promotions.map(p => `@${p.userId.split('@')[0]}`).join(', ');
      const event = this.db.getActiveEvent(chatId);
      await this.sendAside(chatId, sock, t(locale, 'bulkPromoted', names, event?.title ?? ''), mentions);
    }
    if (result.showStatus) await this.handleStatus(msg, chatId, sock, locale);
  }

  private async handleCancel(msg: WAMessage, chatId: string, userId: string, sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const result = this.eventService.cancelEvent(chatId);
    await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any, ...(result.params || [])));
  }

  private async handleConclude(msg: WAMessage, chatId: string, userId: string, sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }
    const result = this.eventService.concludeEvent(chatId);
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
      const parsed = parsePositiveInt(args[0]);
      if (parsed === null || parsed < 2) {
        return await this.safeReply(msg, chatId, sock, t(locale, 'groupsInvalidSize'));
      }
      membersPerGroup = parsed;
    }

    const groups = this.eventService.makeGroups(event.id, membersPerGroup);
    const text = formatGroups(groups, membersPerGroup, locale, t);
    if (!text) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'groupsNotEnough'));
    }
    await this.safeReply(msg, chatId, sock, text);
  }

  async handleStatus(msg: WAMessage, chatId: string, sock: WASocket, locale: Locale) {
    const result = this.eventService.getStatus(chatId);
    if (!result.success) {
      return await this.safeReply(msg, chatId, sock, t(locale, result.messageKey as any));
    }
    const data = result.data!;
    const joined = data.participants.filter((p: any) => p.status === 'joined' || p.status === 'pending_promotion');
    const waitlisted = data.participants.filter((p: any) => p.status === 'waitlisted');

    let text = `${t(locale, 'statusHeader', data.title)}\n`;
    text += `${t(locale, 'statusSlots', joined.length, data.slots)}\n`;

    if (data.event_at && data.timezone) {
      const dateStr = formatEventDate(data.event_at, data.timezone, locale);
      text += `${t(locale, 'statusEventDate', dateStr)}\n`;
      const msUntil = Date.parse(data.event_at) - Date.now();
      if (msUntil > 60_000) {
        text += `${t(locale, 'statusCountdown', formatCountdown(msUntil))}\n`;
      } else if (msUntil > 0) {
        text += `${t(locale, 'statusCountdownSoon')}\n`;
      }
    }

    text += `\n${t(locale, 'statusParticipants')}\n`;
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

/** Every id the bot answers to, so it can tell when a message addresses it. */
function collectBotJids(sock: WASocket): string[] {
  const ids = [sock.user?.id, sock.user?.lid].filter((id): id is string => !!id);
  return [...new Set(ids.map(jidNormalizedUser))];
}

/**
 * Pairs each @mention with the display name the sender's client wrote for it,
 * then drops the bot's own mention — addressing the bot is not a request to
 * sign it up or remove it.
 *
 * The pairing happens before the filtering because the two lists are only
 * aligned by position: removing from one alone shifts every later name.
 */
function collectMentions(msg: WAMessage, mentionedJids: string[], botJids: string[]): Mention[] {
  const text = msg.message?.extendedTextMessage?.text ?? '';
  const isolateNames = [...text.matchAll(/⁨([^⁩]+)⁩/g)].map(m => m[1]!);

  return mentionedJids
    .map((jid, i) => ({ jid, isolateName: isolateNames[i] }))
    .filter(mention => !botJids.includes(mention.jid));
}
