import type { Chat, GroupChat, Message, Client } from 'whatsapp-web.js';
import * as db from './database.js';
import { t, type Locale } from './i18n.js';
import { resolveCommand } from './commandAliases.js';

export async function handleCommand(message: Message, client: Client) {
  try {
    const chat = await message.getChat() as GroupChat;
    if (!chat.isGroup) return;
    const senderId = message.fromMe ? client.info.wid._serialized : (message.author || message.from);
    if (!senderId) return;

    const contact = await client.getContactById(senderId);
    if (!contact) return;

    const userId = contact.id._serialized;
    const userName = contact.pushname || contact.number;
    const body = message.body.trim();
    if (!body.startsWith('!')) return;

    console.log(`[handleCommand] Processing command: "${body}" | fromMe: ${message.fromMe}`);

    const [rawCommand, ...args] = body.split(' ');
    if (!rawCommand) return;
    const action = resolveCommand(rawCommand.toLowerCase());
    if (!action) return;

    const chatId = chat.id._serialized;
    const locale = db.getLocale(chatId);

    switch (action) {
      case 'create':
        await handleCreate(message, chat, userId, args, client, locale);
        break;
      case 'join':
        await handleJoin(message, chat, userId, userName, client, locale, false);
        break;
      case 'waitlist':
        await handleJoin(message, chat, userId, userName, client, locale, true);
        break;
      case 'leave':
        await handleLeave(message, chat, userId, userName, client, locale);
        break;
      case 'status':
        await handleStatus(message, chat, client, locale);
        break;
      case 'cancel':
        await handleCancel(message, chat, userId, client, locale);
        break;
      case 'lang':
        await handleLang(message, chat, userId, args, client);
        break;
      case 'help':
        await safeReply(message, chat, client, t(locale, 'helpMessage'));
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Error in handleCommand:', err);
  }
}

async function handleLang(message: Message, chat: GroupChat, userId: string, args: string[], client: Client) {
  const chatId = chat.id._serialized;
  const locale = db.getLocale(chatId);

  if (!(await isAdmin(chat, userId))) {
    return await safeReply(message, chat, client, t(locale, 'adminOnly'));
  }

  const newLang = args[0]?.toLowerCase();
  if (!newLang) {
    return await safeReply(message, chat, client, t(locale, 'langUsage'));
  }
  if (newLang !== 'en' && newLang !== 'es') {
    return await safeReply(message, chat, client, t(locale, 'langInvalid'));
  }

  db.setLocale(chatId, newLang);
  await safeReply(message, chat, client, t(newLang, 'langChanged', newLang));
}

async function handleCancel(message: Message, chat: GroupChat, userId: string, client: Client, locale: Locale) {
  if (!(await isAdmin(chat, userId))) {
    return await safeReply(message, chat, client, t(locale, 'adminOnly'));
  }

  const event = db.getActiveEvent(chat.id._serialized);
  if (!event) return await safeReply(message, chat, client, t(locale, 'noActiveEventCancel'));

  db.cancelEvent(event.id);
  await safeReply(message, chat, client, t(locale, 'eventCancelled', event.title));
}

async function isAdmin(chat: GroupChat, userId: string): Promise<boolean> {
  if (!chat.isGroup) return true;

  if (!chat.participants || chat.participants.length === 0) {
    console.warn(`[isAdmin] No participants cached for group ${chat.id._serialized}.`);
  }

  const participant = chat.participants?.find((p: any) => (p.id?._serialized || p.id) === userId);
  return !!(participant && (participant.isAdmin || participant.isSuperAdmin));
}

async function handleCreate(message: Message, chat: GroupChat, userId: string, args: string[], client: Client, locale: Locale) {
  if (!(await isAdmin(chat, userId))) {
    return await safeReply(message, chat, client, t(locale, 'adminOnly'));
  }

  // Flexible regex: handles all create aliases, straight and curly quotes
  const match = message.body.match(/(?:!create|!crear)\s+(?:"([^"]+)"|"([^"]+)"|(\S+))\s+(\d+)/i);
  if (!match) {
    console.log('[handleCreate] Regex failed to match body:', message.body);
    return await safeReply(message, chat, client, t(locale, 'createUsage'));
  }

  const title = (match[1] ?? match[2] ?? match[3] ?? "").trim().substring(0, 100);
  const slotsStr = match[4] ?? "0";
  if (!title || slotsStr === "0") return;
  const slots = Math.min(parseInt(slotsStr), 1000);

  db.createEvent(chat.id._serialized, title, slots, true, userId);
  console.log(`[handleCreate] Created event: "${title}" (${slots} slots)`);
  await safeReply(message, chat, client, t(locale, 'eventCreated', title, slots));
}

async function handleJoin(message: Message, chat: GroupChat, userId: string, userName: string, client: Client, locale: Locale, forceWaitlist = false) {
  const event = db.getActiveEvent(chat.id._serialized);
  if (!event) return await safeReply(message, chat, client, t(locale, 'noActiveEvent'));

  const existing = db.getParticipant(event.id, userId);

  if (existing) {
    if (existing.status === 'pending_promotion') {
      db.updateParticipantStatus(event.id, userId, 'joined');
      await safeReply(message, chat, client, t(locale, 'confirmedSpot', contactMention(userId), event.title), { mentions: [userId] });
      return await handleStatus(message, chat, client, locale);
    }
    const msg = existing.status === 'joined' ? t(locale, 'alreadyJoined') : t(locale, 'alreadyWaitlisted');
    return await safeReply(message, chat, client, msg);
  }

  const participants = db.getParticipants(event.id);
  const joinedCount = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion').length;

  if (!forceWaitlist && joinedCount < event.slots) {
    db.addParticipant(event.id, userId, userName, 'joined');
    await safeReply(message, chat, client, t(locale, 'joined', contactMention(userId), event.title), { mentions: [userId] });
    await handleStatus(message, chat, client, locale);
  } else if (event.waitlist_enabled) {
    db.addParticipant(event.id, userId, userName, 'waitlisted');
    await safeReply(message, chat, client, t(locale, 'joinedWaitlist', contactMention(userId), event.title), { mentions: [userId] });
    await handleStatus(message, chat, client, locale);
  } else {
    await safeReply(message, chat, client, t(locale, 'eventFullNoWaitlist'));
  }
}

async function handleLeave(message: Message, chat: GroupChat, userId: string, userName: string, client: Client, locale: Locale) {
  const event = db.getActiveEvent(chat.id._serialized);
  if (!event) return;

  const participant = db.getParticipant(event.id, userId);
  if (!participant) return await safeReply(message, chat, client, t(locale, 'notSignedUp'));

  const oldStatus = participant.status;
  db.withdrawParticipant(event.id, userId);
  await safeReply(message, chat, client, t(locale, 'withdrawn', contactMention(userId), event.title), { mentions: [userId] });

  if (oldStatus === 'joined' || oldStatus === 'pending_promotion') {
    await promoteNext(chat, event, client, locale);
  }
}

async function promoteNext(chat: GroupChat, event: db.WhatsAppEvent, client: Client, locale: Locale) {
  const next = db.getNextInWaitlist(event.id);
  if (next) {
    db.updateParticipantStatus(event.id, next.user_id, 'pending_promotion');
    const mention = next.user_id.split('@')[0] ?? '';
    await client.sendMessage(chat.id._serialized, t(locale, 'slotOpened', mention, event.title), { mentions: [next.user_id] });
  }
}

async function handleStatus(message: Message, chat: GroupChat, client: Client, locale: Locale) {
  const event = db.getActiveEvent(chat.id._serialized);
  if (!event) return await safeReply(message, chat, client, t(locale, 'noActiveEventStatus'));

  const participants = db.getParticipants(event.id);
  const joined = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion');
  const waitlisted = participants.filter(p => p.status === 'waitlisted');

  let text = `${t(locale, 'statusHeader', event.title)}\n`;
  text += `${t(locale, 'statusSlots', joined.length, event.slots)}\n\n`;
  text += `${t(locale, 'statusParticipants')}\n`;
  joined.forEach((p, i) => {
    text += `${i + 1}. ${p.user_name} ${p.status === 'pending_promotion' ? t(locale, 'statusPendingTag') : ''}\n`;
  });

  if (waitlisted.length > 0) {
    text += `\n${t(locale, 'statusWaitlist')}\n`;
    waitlisted.forEach((p, i) => {
      text += `${i + 1}. ${p.user_name}\n`;
    });
  }

  await safeReply(message, chat, client, text);
}

async function safeReply(message: Message, chat: Chat | GroupChat, client: Client, text: string, options = {}) {
  try {
    await message.reply(text, chat.id._serialized, options);
  } catch (err: any) {
    console.warn('Reply failed, falling back to direct sendMessage:', err.message);
    await (await message.getChat()).sendMessage(text, options);
  }
}

function contactMention(userId: string): string {
  return userId.split('@')[0] ?? '';
}
