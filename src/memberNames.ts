import type { GroupParticipant, WASocket } from '@whiskeysockets/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import type { DatabaseManager } from './Database.js';
import { formatPhoneNumber } from './formatters.js';

const LID_SUFFIX = '@lid';

const isLidJid = (jid: string): boolean => jid.endsWith(LID_SUFFIX);

/**
 * Finds a group participant by any of the ids WhatsApp may use for them:
 * the primary id, the phone-number JID, or the LID (linked id).
 */
export function findParticipant(participants: GroupParticipant[], jid: string): GroupParticipant | undefined {
  return participants.find(p => p.id === jid || p.phoneNumber === jid || p.lid === jid);
}

/**
 * Collects every JID known to refer to the same member: the mention itself,
 * the alternate ids from group metadata, and the LID<->PN mapping store.
 */
export async function collectMemberJids(jid: string, participant: GroupParticipant | undefined, sock: WASocket): Promise<string[]> {
  const mapped = await lookupMappedJid(jid, sock);
  const candidates = [jid, participant?.id, participant?.phoneNumber, participant?.lid, mapped]
    .filter((j): j is string => typeof j === 'string' && j.length > 0)
    .map(jidNormalizedUser);
  return [...new Set(candidates)];
}

async function lookupMappedJid(jid: string, sock: WASocket): Promise<string | undefined> {
  const mapping = sock.signalRepository?.lidMapping;
  if (!mapping) return undefined;
  try {
    const result = isLidJid(jid) ? await mapping.getPNForLID(jid) : await mapping.getLIDForPN(jid);
    return result ?? undefined;
  } catch (err) {
    console.warn(`LID mapping lookup failed for ${jid}:`, err);
    return undefined;
  }
}

/**
 * Picks the best display name for a member. Order: the name WhatsApp reports
 * on the participant, a name learned from contacts or messages under any of
 * their ids, the name embedded in the mention text, then the formatted phone number.
 * LID digits are only used when nothing else is known.
 */
export function resolveMemberName(
  jids: string[],
  participant: GroupParticipant | undefined,
  contactNames: Map<string, string>,
  isolateName: string | undefined
): string {
  const learned = jids.map(j => contactNames.get(j)).find(name => !!name);
  const phoneJid = jids.find(j => !isLidJid(j));
  const fallback = phoneJid ? formatPhoneNumber(phoneJid.split('@')[0]!) : jids[0]?.split('@')[0];
  return participant?.notify ?? learned ?? isolateName ?? fallback ?? 'Unknown';
}

/**
 * Records a member's public name in memory and in the database, so it
 * survives restarts. Skips the write when the name is already known.
 */
export function rememberMemberName(names: Map<string, string>, db: DatabaseManager, jid: string, name: string): void {
  if (names.get(jid) === name) return;
  names.set(jid, name);
  // The name is only cosmetic: a failed save must not abort the command or
  // event handler that learned it. The in-memory name still serves until restart.
  try {
    db.setMemberName(jid, name);
  } catch (err) {
    console.error(`Failed to save member name for ${jid}:`, err);
  }
}
