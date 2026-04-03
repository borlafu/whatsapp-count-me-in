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
}

export interface Participant {
  id: number;
  event_id: number;
  user_id: string;
  user_name: string;
  status: 'joined' | 'waitlisted' | 'withdrawn' | 'pending_promotion';
  joined_at: string;
}

export class DatabaseManager {
  private db: Database.Database;

  constructor(customPath?: string) {
    const dbPath = customPath || (process.env['NODE_ENV'] === 'test' ? ':memory:' : path.join(process.cwd(), 'events.db'));
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
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
  }

  getLocale(chatId: string): Locale {
    const row = this.db.prepare('SELECT locale FROM chat_settings WHERE chat_id = ?').get(chatId) as { locale: string } | undefined;
    return (row?.locale as Locale) ?? 'en';
  }

  setLocale(chatId: string, locale: Locale): void {
    this.db.prepare('INSERT INTO chat_settings (chat_id, locale) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET locale = excluded.locale').run(chatId, locale);
  }

  createEvent(chatId: string, title: string, slots: number, waitlistEnabled: boolean, createdBy: string): number | bigint {
    const stmt = this.db.prepare(`
      INSERT INTO events (chat_id, title, slots, waitlist_enabled, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(chatId, title, slots, waitlistEnabled ? 1 : 0, createdBy);
    return info.lastInsertRowid;
  }

  getActiveEvent(chatId: string): WhatsAppEvent | undefined {
    return this.db.prepare('SELECT * FROM events WHERE chat_id = ? AND status = \'active\' ORDER BY created_at DESC LIMIT 1').get(chatId) as WhatsAppEvent | undefined;
  }

  addParticipant(eventId: number | bigint, userId: string, userName: string, status: Participant['status']) {
    const stmt = this.db.prepare(`
      INSERT INTO participants (event_id, user_id, user_name, status)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(eventId, userId, userName, status);
  }

  getParticipants(eventId: number | bigint): Participant[] {
    return this.db.prepare('SELECT * FROM participants WHERE event_id = ? AND status IN (\'joined\', \'waitlisted\', \'pending_promotion\') ORDER BY joined_at ASC').all(eventId) as Participant[];
  }

  getParticipant(eventId: number | bigint, userId: string): Participant | undefined {
    return this.db.prepare('SELECT * FROM participants WHERE event_id = ? AND user_id = ? AND status NOT IN (\'withdrawn\')').get(eventId, userId) as Participant | undefined;
  }

  updateParticipantStatus(eventId: number | bigint, userId: string, status: Participant['status']) {
    const stmt = this.db.prepare('UPDATE participants SET status = ? WHERE event_id = ? AND user_id = ?');
    return stmt.run(status, eventId, userId);
  }

  withdrawParticipant(eventId: number | bigint, userId: string) {
    const stmt = this.db.prepare('UPDATE participants SET status = \'withdrawn\' WHERE event_id = ? AND user_id = ?');
    return stmt.run(eventId, userId);
  }

  cancelEvent(eventId: number | bigint) {
    const stmt = this.db.prepare('UPDATE events SET status = \'cancelled\' WHERE id = ?');
    return stmt.run(eventId);
  }

  updateEventSlots(eventId: number | bigint, slots: number) {
    return this.db.prepare('UPDATE events SET slots = ? WHERE id = ?').run(slots, eventId);
  }

  getNextInWaitlist(eventId: number | bigint): Participant | undefined {
    return this.db.prepare('SELECT * FROM participants WHERE event_id = ? AND status = \'waitlisted\' ORDER BY joined_at ASC LIMIT 1').get(eventId) as Participant | undefined;
  }

  clearDatabase() {
    this.db.prepare('DELETE FROM participants').run();
    this.db.prepare('DELETE FROM events').run();
    this.db.prepare('DELETE FROM chat_settings').run();
  }

  close() {
    this.db.close();
  }
}
