import type { WASocket } from '@whiskeysockets/baileys';
import { proto, jidNormalizedUser } from '@whiskeysockets/baileys';
import * as db from './database.js';
import { t, type Locale } from './i18n.js';
import { resolveCommand } from './commandAliases.js';

export async function handleCommand(msg: proto.IWebMessageInfo, sock: WASocket) {
  try {
    if (!msg.key) return;
    const chatId = msg.key.remoteJid;
    if (!chatId || !chatId.endsWith('@g.us')) return; // Not a group

    let senderId = msg.key.participant;
    if (msg.key.fromMe) {
      senderId = sock.user?.id;
    }
    if (!senderId) return;

    // Normalize senderId to avoid device suffixes like 1234:2@s.whatsapp.net
    senderId = jidNormalizedUser(senderId);

    const userName: string = msg.pushName || senderId.split('@')[0] || 'Unknown';
    const body = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!body.startsWith('!')) return;

    console.log(`[handleCommand] Processing command: "${body}"`);

    const [rawCommand, ...args] = body.split(' ');
    if (!rawCommand) return;
    const action = resolveCommand(rawCommand.toLowerCase());
    if (!action) return;

    const locale = db.getLocale(chatId);

    switch (action) {
      case 'create':
        await handleCreate(msg, chatId, senderId, args, sock, locale);
        break;
      case 'join':
        await handleJoin(msg, chatId, senderId, userName, sock, locale, false);
        break;
      case 'waitlist':
        await handleJoin(msg, chatId, senderId, userName, sock, locale, true);
        break;
      case 'leave':
        await handleLeave(msg, chatId, senderId, userName, sock, locale);
        break;
      case 'status':
        await handleStatus(msg, chatId, sock, locale);
        break;
      case 'cancel':
        await handleCancel(msg, chatId, senderId, sock, locale);
        break;
      case 'lang':
        await handleLang(msg, chatId, senderId, args, sock);
        break;
      case 'help':
        await safeReply(msg, chatId, sock, t(locale, 'helpMessage'));
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Error in handleCommand:', err);
  }
}

async function handleLang(msg: proto.IWebMessageInfo, chatId: string, userId: string, args: string[], sock: WASocket) {
  const locale = db.getLocale(chatId);

  if (!(await isAdmin(chatId, userId, sock))) {
    return await safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
  }

  const newLang = args[0]?.toLowerCase();
  if (!newLang) {
    return await safeReply(msg, chatId, sock, t(locale, 'langUsage'));
  }
  if (newLang !== 'en' && newLang !== 'es') {
    return await safeReply(msg, chatId, sock, t(locale, 'langInvalid'));
  }

  db.setLocale(chatId, newLang);
  await safeReply(msg, chatId, sock, t(newLang, 'langChanged', newLang));
}

async function handleCancel(msg: proto.IWebMessageInfo, chatId: string, userId: string, sock: WASocket, locale: Locale) {
  if (!(await isAdmin(chatId, userId, sock))) {
    return await safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
  }

  const event = db.getActiveEvent(chatId);
  if (!event) return await safeReply(msg, chatId, sock, t(locale, 'noActiveEventCancel'));

  db.cancelEvent(event.id);
  await safeReply(msg, chatId, sock, t(locale, 'eventCancelled', event.title));
}

async function isAdmin(chatId: string, userId: string, sock: WASocket): Promise<boolean> {
  if (!chatId.endsWith('@g.us')) return true;

  try {
    const metadata = await sock.groupMetadata(chatId);
    const participant = metadata.participants.find(p => p.id === userId);
    return !!(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
  } catch (e) {
    console.error('[isAdmin] Failed to fetch group metadata:', e);
    return false;
  }
}

async function handleCreate(msg: proto.IWebMessageInfo, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
  if (!(await isAdmin(chatId, userId, sock))) {
    return await safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
  }

  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  const match = body.match(/(?:!create|!crear)\s+(?:"([^"]+)"|"([^"]+)"|(\S+))\s+(\d+)/i);
  if (!match) {
    console.log('[handleCreate] Regex failed to match body:', body);
    return await safeReply(msg, chatId, sock, t(locale, 'createUsage'));
  }

  const title = (match[1] ?? match[2] ?? match[3] ?? "").trim().substring(0, 100);
  const slotsStr = match[4] ?? "0";
  if (!title || slotsStr === "0") return;
  const slots = Math.min(parseInt(slotsStr), 1000);

  db.createEvent(chatId, title, slots, true, userId);
  console.log(`[handleCreate] Created event: "${title}" (${slots} slots)`);
  await safeReply(msg, chatId, sock, t(locale, 'eventCreated', title, slots));
}

async function handleJoin(msg: proto.IWebMessageInfo, chatId: string, userId: string, userName: string, sock: WASocket, locale: Locale, forceWaitlist = false) {
  const event = db.getActiveEvent(chatId);
  if (!event) return await safeReply(msg, chatId, sock, t(locale, 'noActiveEvent'));

  const existing = db.getParticipant(event.id, userId);

  if (existing) {
    if (existing.status === 'pending_promotion') {
      db.updateParticipantStatus(event.id, userId, 'joined');
      await safeReply(msg, chatId, sock, t(locale, 'confirmedSpot', contactMention(userId), event.title), { mentions: [userId] });
      return await handleStatus(msg, chatId, sock, locale);
    }
    const txt = existing.status === 'joined' ? t(locale, 'alreadyJoined') : t(locale, 'alreadyWaitlisted');
    return await safeReply(msg, chatId, sock, txt);
  }

  const participants = db.getParticipants(event.id);
  const joinedCount = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion').length;

  if (!forceWaitlist && joinedCount < event.slots) {
    db.addParticipant(event.id, userId, userName, 'joined');
    await safeReply(msg, chatId, sock, t(locale, 'joined', contactMention(userId), event.title), { mentions: [userId] });
    await handleStatus(msg, chatId, sock, locale);
  } else if (event.waitlist_enabled) {
    db.addParticipant(event.id, userId, userName, 'waitlisted');
    await safeReply(msg, chatId, sock, t(locale, 'joinedWaitlist', contactMention(userId), event.title), { mentions: [userId] });
    await handleStatus(msg, chatId, sock, locale);
  } else {
    await safeReply(msg, chatId, sock, t(locale, 'eventFullNoWaitlist'));
  }
}

async function handleLeave(msg: proto.IWebMessageInfo, chatId: string, userId: string, userName: string, sock: WASocket, locale: Locale) {
  const event = db.getActiveEvent(chatId);
  if (!event) return;

  const participant = db.getParticipant(event.id, userId);
  if (!participant) return await safeReply(msg, chatId, sock, t(locale, 'notSignedUp'));

  const oldStatus = participant.status;
  db.withdrawParticipant(event.id, userId);
  await safeReply(msg, chatId, sock, t(locale, 'withdrawn', contactMention(userId), event.title), { mentions: [userId] });

  if (oldStatus === 'joined' || oldStatus === 'pending_promotion') {
    await promoteNext(chatId, event, sock, locale);
  }
}

async function promoteNext(chatId: string, event: db.WhatsAppEvent, sock: WASocket, locale: Locale) {
  const next = db.getNextInWaitlist(event.id);
  if (next) {
    db.updateParticipantStatus(event.id, next.user_id, 'pending_promotion');
    const mention = next.user_id.split('@')[0] ?? '';
    await sock.sendMessage(chatId, {
      text: t(locale, 'slotOpened', mention, event.title),
      mentions: [next.user_id]
    });
  }
}

async function handleStatus(msg: proto.IWebMessageInfo, chatId: string, sock: WASocket, locale: Locale) {
  const event = db.getActiveEvent(chatId);
  if (!event) return await safeReply(msg, chatId, sock, t(locale, 'noActiveEventStatus'));

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

  await safeReply(msg, chatId, sock, text);
}

async function safeReply(msg: proto.IWebMessageInfo, chatId: string, sock: WASocket, text: string, options: { mentions?: string[] } = {}) {
  try {
    await sock.sendMessage(chatId, { text, mentions: options.mentions || [] }, { quoted: msg as any });
  } catch (err: any) {
    console.warn('Reply failed, falling back to direct sendMessage:', err.message);
    await sock.sendMessage(chatId, { text, mentions: options.mentions || [] });
  }
}

function contactMention(userId: string): string {
  return userId.split('@')[0] ?? '';
}
