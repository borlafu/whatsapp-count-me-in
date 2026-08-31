import { describe, it, expect } from 'vitest';
import { formatCountdown, parseOffsetToMinutes, parsePositiveInt, formatEventDate, localToUtc, formatAbsenceGap } from '../formatters.js';
import { t } from '../i18n.js';

describe('parsePositiveInt', () => {
  it('parses a plain positive integer', () => {
    expect(parsePositiveInt('10')).toBe(10);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePositiveInt(' 7 ')).toBe(7);
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['letters', 'abc'],
    ['zero', '0'],
    ['a negative number', '-5'],
    ['a fraction', '2.5'],
    ['scientific notation', '1e3'],
    ['a flag', '--close-and-group'],
  ])('returns null for %s', (_label, input) => {
    expect(parsePositiveInt(input)).toBeNull();
  });

  it('returns null for trailing garbage instead of truncating', () => {
    expect(parsePositiveInt('12abc')).toBeNull();
  });

  it('returns null for hexadecimal instead of reading base 16', () => {
    expect(parsePositiveInt('0x10')).toBeNull();
  });

  it('returns null beyond the safe integer range', () => {
    expect(parsePositiveInt('9'.repeat(20))).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('should format days and hours', () => {
    const ms = (2 * 24 * 60 + 4 * 60) * 60_000; // 2d 4h
    expect(formatCountdown(ms)).toBe('2d 4h');
  });

  it('should format hours and minutes', () => {
    const ms = (3 * 60 + 20) * 60_000; // 3h 20m
    expect(formatCountdown(ms)).toBe('3h 20m');
  });

  it('should format minutes alone', () => {
    const ms = 45 * 60_000; // 45m
    expect(formatCountdown(ms)).toBe('45m');
  });

  it('should format exactly 1 day', () => {
    const ms = 24 * 60 * 60_000;
    expect(formatCountdown(ms)).toBe('1d 0h');
  });

  it('should format zero minutes', () => {
    expect(formatCountdown(0)).toBe('0m');
  });

  it('should handle fractional minutes (rounds down)', () => {
    const ms = 90_000 + 500; // 1m 30.5s → 1m
    expect(formatCountdown(ms)).toBe('1m');
  });
});

describe('parseOffsetToMinutes', () => {
  it('should parse hours only', () => {
    expect(parseOffsetToMinutes('2h')).toBe(120);
  });

  it('should parse minutes only', () => {
    expect(parseOffsetToMinutes('30m')).toBe(30);
  });

  it('should parse combined hours and minutes', () => {
    expect(parseOffsetToMinutes('1h30m')).toBe(90);
  });

  it('should parse case insensitively', () => {
    expect(parseOffsetToMinutes('1H30M')).toBe(90);
  });

  it('should return null for empty string', () => {
    expect(parseOffsetToMinutes('')).toBeNull();
  });

  it('should return null for invalid format', () => {
    expect(parseOffsetToMinutes('abc')).toBeNull();
    expect(parseOffsetToMinutes('1x')).toBeNull();
    expect(parseOffsetToMinutes('h30m')).toBeNull();
  });

  it('should parse 0h0m as 0', () => {
    expect(parseOffsetToMinutes('0h0m')).toBe(0);
  });
});

describe('formatEventDate', () => {
  it('should format a date in the given timezone', () => {
    // 2026-04-15 18:00 UTC => in Europe/Madrid that's 20:00 (CEST, UTC+2)
    const result = formatEventDate('2026-04-15T18:00:00.000Z', 'Europe/Madrid');
    expect(result).toContain('20:00');
    expect(result).toContain('Wednesday');
    expect(result).toContain('April');
  });

  it('should format correctly for UTC timezone', () => {
    const result = formatEventDate('2026-12-25T10:30:00.000Z', 'UTC');
    expect(result).toContain('10:30');
    expect(result).toContain('Friday');
    expect(result).toContain('December');
  });

  it('should format in Spanish when locale is es', () => {
    const result = formatEventDate('2026-12-25T10:30:00.000Z', 'UTC', 'es');
    expect(result).toContain('10:30');
    expect(result).toContain('viernes');
    expect(result).toContain('diciembre');
  });

  it('should handle negative offset timezones', () => {
    // 2026-04-15T22:00Z => in America/New_York (EDT, UTC-4) => 18:00
    const result = formatEventDate('2026-04-15T22:00:00.000Z', 'America/New_York');
    expect(result).toContain('18:00');
  });
});

describe('localToUtc', () => {
  it('should convert a basic local time to UTC', () => {
    // Europe/Madrid in April is CEST (UTC+2), so 18:00 local = 16:00 UTC
    const result = localToUtc('2026-04-15', '18:00', 'Europe/Madrid');
    expect(result).not.toBeNull();
    const date = new Date(result!);
    expect(date.getUTCHours()).toBe(16);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it('should convert UTC timezone correctly (no offset)', () => {
    const result = localToUtc('2026-06-01', '12:00', 'UTC');
    expect(result).not.toBeNull();
    const date = new Date(result!);
    expect(date.getUTCHours()).toBe(12);
    expect(date.getUTCMinutes()).toBe(0);
  });

  it('should handle negative offset (America/New_York EDT = UTC-4)', () => {
    const result = localToUtc('2026-07-15', '14:00', 'America/New_York');
    expect(result).not.toBeNull();
    const date = new Date(result!);
    expect(date.getUTCHours()).toBe(18);
  });

  it('should return null for invalid date', () => {
    expect(localToUtc('not-a-date', '12:00', 'UTC')).toBeNull();
  });

  it('should return null for invalid timezone', () => {
    expect(localToUtc('2026-04-15', '18:00', 'Invalid/Timezone')).toBeNull();
  });

  it('should return null for invalid time', () => {
    expect(localToUtc('2026-04-15', 'not-time', 'UTC')).toBeNull();
  });

  it('should handle midnight correctly', () => {
    const result = localToUtc('2026-04-15', '00:00', 'Europe/Madrid');
    expect(result).not.toBeNull();
    const date = new Date(result!);
    // Midnight CEST (UTC+2) = 22:00 UTC the day before
    expect(date.getUTCHours()).toBe(22);
    expect(date.getUTCDate()).toBe(14); // April 14th UTC
  });

  it('should correctly round-trip through formatEventDate', () => {
    const utc = localToUtc('2026-08-20', '15:30', 'Asia/Tokyo');
    expect(utc).not.toBeNull();
    const formatted = formatEventDate(utc!, 'Asia/Tokyo');
    expect(formatted).toContain('15:30');
  });
});

describe('formatAbsenceGap', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;

  it('reports whole weeks for short absences', () => {
    expect(formatAbsenceGap(3 * WEEK_MS, 'es', t)).toBe('3 semanas');
    expect(formatAbsenceGap(3 * WEEK_MS, 'en', t)).toBe('3 weeks');
  });

  it('uses the singular for a one-week absence', () => {
    expect(formatAbsenceGap(WEEK_MS, 'es', t)).toBe('1 semana');
    expect(formatAbsenceGap(WEEK_MS, 'en', t)).toBe('1 week');
  });

  it('switches to months once the absence reaches eight weeks', () => {
    // Eight weeks is 1.84 average months, which reads better rounded up.
    expect(formatAbsenceGap(8 * WEEK_MS, 'es', t)).toBe('2 meses');
    // 140 days is 4.6 average months.
    expect(formatAbsenceGap(20 * WEEK_MS, 'es', t)).toBe('5 meses');
    expect(formatAbsenceGap(20 * WEEK_MS, 'en', t)).toBe('5 months');
  });

  it('still reports weeks just below the month cutoff', () => {
    expect(formatAbsenceGap(7 * WEEK_MS, 'es', t)).toBe('7 semanas');
    expect(formatAbsenceGap(7 * WEEK_MS, 'en', t)).toBe('7 weeks');
  });

  it('never reports less than one week, even for a same-day gap', () => {
    expect(formatAbsenceGap(0, 'es', t)).toBe('1 semana');
    expect(formatAbsenceGap(2 * DAY_MS, 'en', t)).toBe('1 week');
  });

  it('treats a negative gap from clock skew as the minimum', () => {
    expect(formatAbsenceGap(-5 * WEEK_MS, 'en', t)).toBe('1 week');
  });
});
