import type { MessageTemplates } from './i18n.js';

/**
 * i18n keys that state how to use a command. All take no arguments.
 *
 * Narrowed through the i18n table rather than written free-hand: a name missing
 * from MessageTemplates is dropped here, and the spec below that asks for it
 * then fails to compile. Without that, a new command could ship pointing at a
 * usage message nobody ever wrote.
 */
export type UsageKey = Extract<keyof MessageTemplates, UsageKeyName>;

type UsageKeyName =
  | 'createUsage'
  | 'joinUsage'
  | 'waitlistUsage'
  | 'leaveUsage'
  | 'statusUsage'
  | 'cancelUsage'
  | 'concludeUsage'
  | 'resizeUsage'
  | 'renameUsage'
  | 'langUsage'
  | 'inviteUsage'
  | 'groupsUsage'
  | 'rescheduleUsage'
  | 'remindersUsage'
  | 'helpUsage';

export interface CommandSpec {
  /**
   * How many arguments the command reads. Anything beyond this is a mistake,
   * not noise: "!leave Juanlu" used to silently withdraw the sender because
   * the extra word was dropped on the floor.
   */
  maxArgs: number;
  usageKey: UsageKey;
  /**
   * Set when the command takes its targets from @mentions. Mention text counts
   * as an argument per mention, so the arity check has to stand down for these
   * or "!invite @a @b" would be rejected as having one argument too many.
   */
  mentionDriven?: true;
}

const specs: Record<string, CommandSpec> = {
  // title, slots, date, time, timezone, --close-and-group, offset
  create: { maxArgs: 7, usageKey: 'createUsage' },
  // date, time, timezone, --close-and-group, offset
  reschedule: { maxArgs: 5, usageKey: 'rescheduleUsage' },
  join: { maxArgs: 0, usageKey: 'joinUsage' },
  waitlist: { maxArgs: 0, usageKey: 'waitlistUsage' },
  leave: { maxArgs: 1, usageKey: 'leaveUsage', mentionDriven: true },
  status: { maxArgs: 0, usageKey: 'statusUsage' },
  cancel: { maxArgs: 0, usageKey: 'cancelUsage' },
  conclude: { maxArgs: 0, usageKey: 'concludeUsage' },
  resize: { maxArgs: 1, usageKey: 'resizeUsage' },
  rename: { maxArgs: 1, usageKey: 'renameUsage' },
  lang: { maxArgs: 1, usageKey: 'langUsage' },
  invite: { maxArgs: 1, usageKey: 'inviteUsage', mentionDriven: true },
  groups: { maxArgs: 1, usageKey: 'groupsUsage' },
  reminders: { maxArgs: 1, usageKey: 'remindersUsage' },
  help: { maxArgs: 0, usageKey: 'helpUsage' },
};

export function commandSpec(action: string): CommandSpec | undefined {
  return specs[action];
}
