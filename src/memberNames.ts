import type { GroupParticipant, WASocket } from '@whiskeysockets/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

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
 * their ids, the name embedded in the mention text, then the phone number.
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
  const fallbackJid = phoneJid ?? jids[0] ?? '';
  return participant?.notify ?? learned ?? isolateName ?? fallbackJid.split('@')[0] ?? 'Unknown';
}
