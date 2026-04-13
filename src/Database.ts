import Database from 'better-sqlite3';
import path from 'path';
import type { Locale } from './i18n.js';

export interface WhatsAppEvent {
  id: number;
  chat_id: string;
  title: string;
  slots: number;
  waitlist_enabled: number;
  created_by: string;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  event_at?: string;
  timezone?: string;
  close_and_group_offset_min?: number;
  groups_triggered?: number;
  last_reminder_date?: string;
}

export interface Participant {
  id: number;
  event_id: number;
  user_id: string;
  user_name: string;
  status: 'joined' | 'waitlisted' | 'withdrawn' | 'pending_promotion';
  invited_by?: string;
  invited_by_name?: string;
  joined_at: string;
}

const CURRENT_SCHEMA_VERSION = 2;

export class DatabaseManager {
  private db: Database.Database;

  constructor(customPath?: string) {
    const dbPath = customPath || (process.env['NODE_ENV'] === 'test' ? ':memory:' : path.join(process.cwd(), 'events.db'));
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        slots INTEGER NOT NULL,
        waitlist_enabled INTEGER DEFAULT 1,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        status TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id)
      );

      CREATE TABLE IF NOT EXISTS chat_settings (
        chat_id TEXT PRIMARY KEY,
        locale TEXT NOT NULL DEFAULT 'en'
      );
    `);

    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
    const version = parseInt(row?.value ?? '0');

    if (version < 1) {
      this.db.exec(`
        ALTER TABLE participants ADD COLUMN invited_by TEXT;
        ALTER TABLE participants ADD COLUMN invited_by_name TEXT;
      `);
    }

    if (version < 2) {
      this.db.exec(`
        ALTER TABLE events ADD COLUMN event_at TEXT;
        ALTER TABLE events ADD COLUMN timezone TEXT;
        ALTER TABLE events ADD COLUMN close_and_group_offset_min INTEGER;
        ALTER TABLE events ADD COLUMN groups_triggered INTEGER DEFAULT 0;
        ALTER TABLE events ADD COLUMN last_reminder_date TEXT;
        ALTER TABLE chat_settings ADD COLUMN reminders_enabled INTEGER DEFAULT 1;
      `);
    }

    this.db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(String(CURRENT_SCHEMA_VERSION));
  }

  getLocale(chatId: string): Locale {
    const row = this.db.prepare('SELECT locale FROM chat_settings WHERE chat_id = ?').get(chatId) as { locale: string } | undefined;
    return (row?.locale as Locale) ?? 'en';
  }

  setLocale(chatId: string, locale: Locale): void {
    this.db.prepare('INSERT INTO chat_settings (chat_id, locale) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET locale = excluded.locale').run(chatId, locale);
  }

  createEvent(chatId: string, title: string, slots: number, waitlistEnabled: boolean, createdBy: string, eventAt?: string, timezone?: string, closeAndGroupOffsetMin?: number): number | bigint {
    const stmt = this.db.prepare(`
      INSERT INTO events (chat_id, title, slots, waitlist_enabled, created_by, event_at, timezone, close_and_group_offset_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(chatId, title, slots, waitlistEnabled ? 1 : 0, createdBy, eventAt ?? null, timezone ?? null, closeAndGroupOffsetMin ?? null);
    return info.lastInsertRowid;
  }

  getActiveEvent(chatId: string): WhatsAppEvent | undefined {
    return this.db.prepare(`SELECT * FROM events WHERE chat_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`).get(chatId) as WhatsAppEvent | undefined;
  }

  getActiveTimedEvents(): WhatsAppEvent[] {
    return this.db.prepare(`SELECT * FROM events WHERE status = 'active' AND event_at IS NOT NULL`).all() as WhatsAppEvent[];
  }

  updateEventSchedule(eventId: number | bigint, eventAt: string, timezone: string, closeAndGroupOffsetMin?: number): void {
    this.db.prepare(`UPDATE events SET event_at = ?, timezone = ?, close_and_group_offset_min = ?, groups_triggered = 0 WHERE id = ?`)
      .run(eventAt, timezone, closeAndGroupOffsetMin ?? null, eventId);
  }

  getLastReminderDate(eventId: number | bigint): string | null {
    const row = this.db.prepare(`SELECT last_reminder_date FROM events WHERE id = ?`).get(eventId) as { last_reminder_date: string | null } | undefined;
    return row?.last_reminder_date ?? null;
  }

  setLastReminderDate(eventId: number | bigint, date: string): void {
    this.db.prepare(`UPDATE events SET last_reminder_date = ? WHERE id = ?`).run(date, eventId);
  }

  setGroupsTriggered(eventId: number | bigint): void {
    this.db.prepare(`UPDATE events SET groups_triggered = 1 WHERE id = ?`).run(eventId);
  }

  getRemindersEnabled(chatId: string): boolean {
    const row = this.db.prepare(`SELECT reminders_enabled FROM chat_settings WHERE chat_id = ?`).get(chatId) as { reminders_enabled: number } | undefined;
    return (row?.reminders_enabled ?? 1) === 1;
  }

  setRemindersEnabled(chatId: string, enabled: boolean): void {
    this.db.prepare(
      `INSERT INTO chat_settings (chat_id, locale, reminders_enabled) VALUES (?, COALESCE((SELECT locale FROM chat_settings WHERE chat_id = ?), 'en'), ?)
       ON CONFLICT(chat_id) DO UPDATE SET reminders_enabled = excluded.reminders_enabled`
    ).run(chatId, chatId, enabled ? 1 : 0);
  }

  addParticipant(eventId: number | bigint, userId: string, userName: string, status: Participant['status'], invitedBy?: string, invitedByName?: string) {
    const stmt = this.db.prepare(`
      INSERT INTO participants (event_id, user_id, user_name, status, invited_by, invited_by_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(eventId, userId, userName, status, invitedBy, invitedByName);
  }

  getParticipants(eventId: number | bigint): Participant[] {
    return this.db.prepare(`SELECT * FROM participants WHERE event_id = ? AND status IN ('joined', 'waitlisted', 'pending_promotion') ORDER BY joined_at ASC`).all(eventId) as Participant[];
  }

  getParticipant(eventId: number | bigint, userId: string): Participant | undefined {
    return this.db.prepare(`SELECT * FROM participants WHERE event_id = ? AND user_id = ? AND status NOT IN ('withdrawn')`).get(eventId, userId) as Participant | undefined;
  }

  updateParticipantStatus(eventId: number | bigint, userId: string, status: Participant['status']) {
    return this.db.prepare(`UPDATE participants SET status = ? WHERE event_id = ? AND user_id = ?`).run(status, eventId, userId);
  }

  withdrawParticipant(eventId: number | bigint, userId: string) {
    return this.db.prepare(`UPDATE participants SET status = 'withdrawn' WHERE event_id = ? AND user_id = ?`).run(eventId, userId);
  }

  cancelEvent(eventId: number | bigint) {
    return this.db.prepare(`UPDATE events SET status = 'cancelled' WHERE id = ?`).run(eventId);
  }

  updateEventSlots(eventId: number | bigint, slots: number) {
    return this.db.prepare(`UPDATE events SET slots = ? WHERE id = ?`).run(slots, eventId);
  }

  updateEventTitle(eventId: number | bigint, title: string) {
    return this.db.prepare(`UPDATE events SET title = ? WHERE id = ?`).run(title, eventId);
  }

  getNextInWaitlist(eventId: number | bigint): Participant | undefined {
    return this.db.prepare(`SELECT * FROM participants WHERE event_id = ? AND status = 'waitlisted' ORDER BY joined_at ASC LIMIT 1`).get(eventId) as Participant | undefined;
  }

  clearDatabase() {
    this.db.prepare('DELETE FROM participants').run();
    this.db.prepare('DELETE FROM events').run();
    this.db.prepare('DELETE FROM chat_settings').run();
    this.db.prepare(`DELETE FROM meta`).run();
  }

  close() {
    this.db.close();
  }
}
