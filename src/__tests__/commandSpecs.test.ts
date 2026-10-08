import { describe, it, expect } from 'vitest';
import { knownActions } from '../commandAliases.js';
import { commandSpec } from '../commandSpecs.js';

describe('commandSpecs', () => {
  it('covers every command, so a new one cannot slip past the argument check', () => {
    const uncovered = knownActions().filter(action => !commandSpec(action));

    expect(uncovered).toEqual([]);
  });

  it('allows a fully scheduled !create, flag and all', () => {
    // !create "Title" 10 2026-01-01 20:00 Europe/Madrid --close-and-group 1h
    expect(commandSpec('create')!.maxArgs).toBe(7);
  });

  it('allows a fully scheduled !reschedule, flag and all', () => {
    // !reschedule 2026-01-01 20:00 Europe/Madrid --close-and-group 1h
    expect(commandSpec('reschedule')!.maxArgs).toBe(5);
  });

  it('expects no arguments at all for the self-service commands', () => {
    for (const action of ['join', 'waitlist', 'status', 'cancel', 'conclude', 'help']) {
      expect(commandSpec(action)!.maxArgs).toBe(0);
    }
  });
});
