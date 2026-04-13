import type { DatabaseManager } from './Database.js';
import type { EventService } from './EventService.js';
import { t, type Locale } from './i18n.js';
import { formatCountdown, formatGroups } from './formatters.js';

export class Scheduler {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: DatabaseManager,
    private eventService: EventService,
    private sendMessage: (chatId: string, text: string) => Promise<void>,
    private getLocale: (chatId: string) => Locale,
    private nowFn: () => number = Date.now,
  ) {}

  start() {
    this.tick();
    this.handle = setInterval(() => this.tick(), 60_000);
  }

  stop() {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  private tick() {
    const events = this.db.getActiveTimedEvents();
    const now = this.nowFn();
    const utcDate = new Date(now);
    const utcHour = utcDate.getUTCHours();
    const utcMin = utcDate.getUTCMinutes();
    const isDailyReminderWindow = utcHour === 9 && utcMin < 2;
    const todayStr = utcDate.toISOString().slice(0, 10);

    for (const event of events) {
      const locale = this.getLocale(event.chat_id);
      const msUntilEvent = Date.parse(event.event_at!) - now;

      if (msUntilEvent <= 0) {
        // Auto-cancel
        this.eventService.cancelEvent(event.chat_id);
        this.sendMessage(event.chat_id, t(locale, 'eventCancelled', event.title)).catch(console.error);
        continue;
      }

      // Close-and-group trigger
      if (
        event.close_and_group_offset_min &&
        !event.groups_triggered &&
        msUntilEvent <= event.close_and_group_offset_min * 60_000
      ) {
        this.db.setGroupsTriggered(event.id);
        const groups = this.eventService.makeGroups(event.id);
        const groupsText = formatGroups(groups, 4, locale, t);
        const msg = t(locale, 'closedForGroups', event.title) + (groupsText ? `\n\n${groupsText}` : '');
        this.sendMessage(event.chat_id, msg).catch(console.error);
        continue;
      }

      // Daily reminder at ~09:00 UTC (with dedup to prevent double sends)
      if (isDailyReminderWindow && this.db.getRemindersEnabled(event.chat_id)) {
        const lastDate = this.db.getLastReminderDate(event.id);
        if (lastDate === todayStr) continue;

        this.db.setLastReminderDate(event.id, todayStr);
        const participants = this.db.getParticipants(event.id);
        const joinedCount = participants.filter(p => p.status === 'joined' || p.status === 'pending_promotion').length;
        const available = event.slots - joinedCount;
        const countdown = formatCountdown(msUntilEvent);
        this.sendMessage(event.chat_id, t(locale, 'reminderMessage', event.title, available, event.slots, countdown))
          .catch(console.error);
      }
    }
  }
}
