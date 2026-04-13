import type { Participant } from './Database.js';
import { t, type Locale } from './i18n.js';

/** Shared helper: formats groups output. Returns empty string if not enough participants. */
export function formatGroups(
  groups: Participant[][],
  membersPerGroup: number,
  locale: Locale,
  tFn: typeof t
): string {
  const totalParticipants = groups.reduce((sum, g) => sum + g.length, 0);
  if (totalParticipants < 2) return '';

  let text = `${tFn(locale, 'groupsHeader', membersPerGroup)}\n`;
  groups.forEach((group, i) => {
    text += `\n${tFn(locale, 'groupLabel', i + 1)}\n`;
    group.forEach(p => {
      const displayName = p.invited_by
        ? tFn(locale, 'statusGuest', p.user_name, p.invited_by_name || 'Admin')
        : p.user_name;
      text += `- ${displayName}\n`;
    });
  });
  return text;
}

/** Formats a UTC ISO string as a human-readable date in the given timezone. */
export function formatEventDate(eventAt: string, timezone: string, locale: Locale = 'en'): string {
  const date = new Date(eventAt);
  const intlLocale = locale === 'es' ? 'es-ES' : 'en-GB';

  const datePart = new Intl.DateTimeFormat(intlLocale, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  const timePart = new Intl.DateTimeFormat(intlLocale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart} · ${timePart}`;
}

/** Converts a local date/time string + IANA timezone to a UTC ISO string. */
export function localToUtc(dateStr: string, timeStr: string, timezone: string): string | null {
  try {
    // Validate the date/time string parses at all
    const naive = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(naive.getTime())) return null;

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    // Treat the input as if it were UTC, then measure the offset the TZ applies
    const testDate = new Date(`${dateStr}T${timeStr}:00Z`);
    const parts = formatter.formatToParts(testDate);
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const localInTz = new Date(`${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:${p['second']}Z`);
    const offsetMs = testDate.getTime() - localInTz.getTime();
    const result = new Date(testDate.getTime() + offsetMs);

    // Round-trip verification: format the result back in the target TZ and
    // confirm it matches the requested local time. This catches DST gaps
    // (e.g. 2:30 AM during spring-forward) where the input time doesn't exist.
    const verifyParts = formatter.formatToParts(result);
    const vp: Record<string, string> = {};
    for (const part of verifyParts) vp[part.type] = part.value;
    const verifyTime = `${vp['hour']}:${vp['minute']}`;
    const normalizedInput = timeStr.padStart(5, '0');
    if (verifyTime !== normalizedInput) return null;

    return result.toISOString();
  } catch {
    return null;
  }
}

/** Returns a countdown string like "2d 4h" or "3h 20m". */
export function formatCountdown(msUntil: number): string {
  const totalMin = Math.floor(msUntil / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Parses an offset string like "1h", "30m", "2h30m" into minutes. Returns null if invalid. */
export function parseOffsetToMinutes(s: string): number | null {
  const match = s.match(/^(?:(\d+)h)?(?:(\d+)m)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return (parseInt(match[1] ?? '0') * 60) + parseInt(match[2] ?? '0');
}
