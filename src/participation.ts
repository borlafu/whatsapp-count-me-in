import type { ParticipationRow } from './Database.js';

/** Number of consecutively missed events after which a returning user is welcomed back. */
export const COMEBACK_ABSENCE_THRESHOLD = 3;

/** Shortest streak worth warning about when someone is about to withdraw. */
export const STREAK_LOSS_MIN = 2;

export interface ParticipationSummary {
  /** True when the user has never attended a past event in this group. */
  isFirstTime: boolean;
  /** Consecutive past events attended, counting back from the most recent one. */
  currentStreak: number;
  /** Consecutive past events missed since the user last attended. */
  missedSinceLastParticipation: number;
  /** When the user last attended, or null if they never have. */
  lastParticipatedAt: string | null;
}

export type JoinCheer =
  | { key: 'cheerFirstTime' }
  | { key: 'cheerStreak'; streak: number }
  | { key: 'cheerComeback'; gapMs: number };

/**
 * Streak lengths worth cheering: 3, 5, then every tenth event. Cheering every
 * join past 3 would spam groups that meet weekly.
 */
export function isStreakMilestone(streak: number): boolean {
  if (streak <= 0) return false;
  return streak === 3 || streak === 5 || streak % 10 === 0;
}

/**
 * Reduces one user's attendance history for a single group into the facts the
 * cheer rules need. Rows must be ordered oldest first.
 */
export function summarizeHistory(rows: ParticipationRow[]): ParticipationSummary {
  // Both counts read backwards from the most recent event, so at most one of
  // them can be non-zero: a trailing absence means there is no live streak.
  let currentStreak = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i]!.participated; i--) {
    currentStreak += 1;
  }

  let missedSinceLastParticipation = 0;
  for (let i = rows.length - 1; i >= 0 && !rows[i]!.participated; i--) {
    missedSinceLastParticipation += 1;
  }

  let lastParticipatedAt: string | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.participated) {
      lastParticipatedAt = rows[i]!.occurred_at;
      break;
    }
  }

  return {
    isFirstTime: lastParticipatedAt === null,
    currentStreak,
    missedSinceLastParticipation,
    lastParticipatedAt,
  };
}

/**
 * Picks the cheer for a join that just took a real spot, or null when this join
 * is unremarkable. First-timers win over comebacks, which win over streaks.
 */
export function selectJoinCheer(summary: ParticipationSummary, nowMs: number): JoinCheer | null {
  if (summary.isFirstTime) {
    return { key: 'cheerFirstTime' };
  }

  if (summary.missedSinceLastParticipation >= COMEBACK_ABSENCE_THRESHOLD && summary.lastParticipatedAt) {
    return { key: 'cheerComeback', gapMs: nowMs - Date.parse(summary.lastParticipatedAt) };
  }

  // The current join extends the streak recorded in past events.
  const streak = summary.currentStreak + 1;
  if (isStreakMilestone(streak)) {
    return { key: 'cheerStreak', streak };
  }

  return null;
}
