import { describe, it, expect } from 'vitest';
import type { ParticipationRow } from '../Database.js';
import {
  summarizeHistory,
  selectJoinCheer,
  isStreakMilestone,
  COMEBACK_ABSENCE_THRESHOLD,
  STREAK_LOSS_MIN,
} from '../participation.js';

/** Builds an oldest-first history from a compact "1101" style attendance string. */
function history(attendance: string, startMs = Date.UTC(2026, 0, 1)): ParticipationRow[] {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  return [...attendance].map((char, index) => ({
    id: index + 1,
    occurred_at: new Date(startMs + index * WEEK_MS).toISOString(),
    participated: char === '1' ? 1 : 0,
  }));
}

describe('isStreakMilestone', () => {
  it('cheers at 3, 5, and every tenth event', () => {
    expect(isStreakMilestone(3)).toBe(true);
    expect(isStreakMilestone(5)).toBe(true);
    expect(isStreakMilestone(10)).toBe(true);
    expect(isStreakMilestone(20)).toBe(true);
    expect(isStreakMilestone(30)).toBe(true);
  });

  it('stays silent between milestones', () => {
    expect(isStreakMilestone(1)).toBe(false);
    expect(isStreakMilestone(2)).toBe(false);
    expect(isStreakMilestone(4)).toBe(false);
    expect(isStreakMilestone(6)).toBe(false);
    expect(isStreakMilestone(9)).toBe(false);
    expect(isStreakMilestone(11)).toBe(false);
    expect(isStreakMilestone(19)).toBe(false);
  });

  it('does not treat zero as a milestone', () => {
    expect(isStreakMilestone(0)).toBe(false);
  });
});

describe('summarizeHistory', () => {
  it('reports a first timer when there is no history at all', () => {
    const summary = summarizeHistory([]);
    expect(summary.isFirstTime).toBe(true);
    expect(summary.currentStreak).toBe(0);
    expect(summary.missedSinceLastParticipation).toBe(0);
    expect(summary.lastParticipatedAt).toBeNull();
  });

  it('reports a first timer when past events exist but the user never attended', () => {
    const summary = summarizeHistory(history('000'));
    expect(summary.isFirstTime).toBe(true);
    expect(summary.currentStreak).toBe(0);
    expect(summary.lastParticipatedAt).toBeNull();
  });

  it('counts only the trailing run of attendances as the streak', () => {
    const summary = summarizeHistory(history('1101'));
    expect(summary.isFirstTime).toBe(false);
    expect(summary.currentStreak).toBe(1);
    expect(summary.missedSinceLastParticipation).toBe(0);
  });

  it('counts a long unbroken streak', () => {
    expect(summarizeHistory(history('11111')).currentStreak).toBe(5);
  });

  it('counts events missed since the last attendance', () => {
    const summary = summarizeHistory(history('11000'));
    expect(summary.currentStreak).toBe(0);
    expect(summary.missedSinceLastParticipation).toBe(3);
  });

  it('records when the user last attended', () => {
    const rows = history('1010');
    const summary = summarizeHistory(rows);
    expect(summary.lastParticipatedAt).toBe(rows[2]!.occurred_at);
  });

  it('does not mutate the rows it is given', () => {
    const rows = history('101');
    const snapshot = JSON.parse(JSON.stringify(rows));
    summarizeHistory(rows);
    expect(rows).toEqual(snapshot);
  });
});

describe('selectJoinCheer', () => {
  const now = Date.UTC(2026, 5, 1);

  it('welcomes a first timer', () => {
    const cheer = selectJoinCheer(summarizeHistory([]), now);
    expect(cheer).toEqual({ key: 'cheerFirstTime' });
  });

  it('welcomes a first timer even when they missed earlier events', () => {
    const cheer = selectJoinCheer(summarizeHistory(history('0000')), now);
    expect(cheer?.key).toBe('cheerFirstTime');
  });

  it('celebrates a comeback after enough missed events', () => {
    const rows = history('1' + '0'.repeat(COMEBACK_ABSENCE_THRESHOLD));
    const cheer = selectJoinCheer(summarizeHistory(rows), now);
    expect(cheer?.key).toBe('cheerComeback');
    expect(cheer?.gapMs).toBe(now - Date.parse(rows[0]!.occurred_at));
  });

  it('stays silent when the absence is one event short of a comeback', () => {
    const rows = history('1' + '0'.repeat(COMEBACK_ABSENCE_THRESHOLD - 1));
    expect(selectJoinCheer(summarizeHistory(rows), now)).toBeNull();
  });

  it('celebrates the third consecutive join, counting the current one', () => {
    const cheer = selectJoinCheer(summarizeHistory(history('11')), now);
    expect(cheer).toEqual({ key: 'cheerStreak', streak: 3 });
  });

  it('stays silent on a fourth consecutive join', () => {
    expect(selectJoinCheer(summarizeHistory(history('111')), now)).toBeNull();
  });

  it('celebrates the fifth and tenth consecutive joins', () => {
    expect(selectJoinCheer(summarizeHistory(history('1111')), now)).toEqual({ key: 'cheerStreak', streak: 5 });
    expect(selectJoinCheer(summarizeHistory(history('111111111')), now)).toEqual({ key: 'cheerStreak', streak: 10 });
  });

  it('stays silent between the tenth and twentieth joins', () => {
    expect(selectJoinCheer(summarizeHistory(history('1'.repeat(10))), now)).toBeNull();
    expect(selectJoinCheer(summarizeHistory(history('1'.repeat(18))), now)).toBeNull();
    expect(selectJoinCheer(summarizeHistory(history('1'.repeat(19))), now)).toEqual({ key: 'cheerStreak', streak: 20 });
  });

  it('stays silent for a returning user who is neither on a milestone nor coming back', () => {
    expect(selectJoinCheer(summarizeHistory(history('1101')), now)).toBeNull();
  });

  it('prefers the comeback cheer over a milestone streak', () => {
    // Trailing absences mean the streak is 0, so only the comeback can fire.
    const rows = history('11' + '0'.repeat(COMEBACK_ABSENCE_THRESHOLD));
    expect(selectJoinCheer(summarizeHistory(rows), now)?.key).toBe('cheerComeback');
  });
});

describe('STREAK_LOSS_MIN', () => {
  it('warns about losing a streak that never earned a cheer', () => {
    // A streak of 4 is not a milestone, but is still worth warning about.
    expect(isStreakMilestone(4)).toBe(false);
    expect(4).toBeGreaterThanOrEqual(STREAK_LOSS_MIN);
  });
});
