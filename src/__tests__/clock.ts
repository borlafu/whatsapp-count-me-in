import { afterEach, beforeEach, vi } from 'vitest';

/** Every hard-coded event date in the tests falls after this instant. */
export const TODAY = '2026-01-01T00:00:00.000Z';

/**
 * Pins "now" to TODAY for the enclosing describe block, so fixed event dates
 * stay in the future however late the suite runs. Only Date is faked, so
 * awaits and real timers behave normally.
 */
export function pinToday(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(TODAY));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
