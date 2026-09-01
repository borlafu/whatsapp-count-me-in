import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseManager, type Participant } from '../Database.js';
import fs from 'fs';
import path from 'path';

describe('DatabaseManager concludeEvent', () => {
  it('should mark event as concluded and remove it from active events', () => {
    const db = new DatabaseManager(':memory:');
    const chatId = 'chat@g.us';
    db.createEvent(chatId, 'Test Event', 10, true, 'admin@s.whatsapp.net');
    const event = db.getActiveEvent(chatId)!;
    expect(event).toBeDefined();
    db.concludeEvent(event.id);
    expect(db.getActiveEvent(chatId)).toBeUndefined();
    db.close();
  });
});

describe('DatabaseManager Migration', () => {
  const testDbPath = path.join(process.cwd(), 'test-migration.db');

  it('should automatically add missing columns to an existing participants table', () => {
    // 1. Create a "legacy" database with the old schema
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const legacyDb = new Database(testDbPath);
    
    legacyDb.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        slots INTEGER NOT NULL,
        waitlist_enabled INTEGER DEFAULT 1,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        status TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id)
      );
    `);
    legacyDb.close();

    // 2. Instantiate DatabaseManager with this legacy database
    const dbManager = new DatabaseManager(testDbPath);

    // 3. Verify that the columns were added
    const columns = (dbManager as any).db.prepare('PRAGMA table_info(participants)').all() as any[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('invited_by');
    expect(columnNames).toContain('invited_by_name');

    // 4. Cleanup
    dbManager.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });
});

describe('DatabaseManager getParticipationHistory', () => {
  const chatId = 'chat@g.us';
  const otherChatId = 'other@g.us';
  const userId = 'user@s.whatsapp.net';
  const adminId = 'admin@s.whatsapp.net';

  /** Creates a scheduled event, signs the given users up, and concludes it. */
  function concludedEvent(
    db: DatabaseManager,
    chat: string,
    title: string,
    eventAt: string,
    attendees: Array<[string, Participant['status']]>
  ): number {
    const eventId = Number(db.createEvent(chat, title, 10, true, adminId, eventAt, 'UTC'));
    for (const [user, status] of attendees) {
      db.addParticipant(eventId, user, user, status);
    }
    db.concludeEvent(eventId);
    return eventId;
  }

  it('returns concluded timed events oldest first, flagging attendance', () => {
    const db = new DatabaseManager(':memory:');
    concludedEvent(db, chatId, 'Week 2', '2026-01-08T18:00:00.000Z', [[userId, 'joined']]);
    concludedEvent(db, chatId, 'Week 1', '2026-01-01T18:00:00.000Z', [[adminId, 'joined']]);

    const rows = db.getParticipationHistory(chatId, userId);
    expect(rows.map(r => r.occurred_at)).toEqual([
      '2026-01-01T18:00:00.000Z',
      '2026-01-08T18:00:00.000Z',
    ]);
    expect(rows.map(r => r.participated)).toEqual([0, 1]);
    db.close();
  });

  it('counts a pending promotion as attendance but not a waitlist spot', () => {
    // The pending row counts because concludeEvent settles it as joined, not
    // because history treats pending_promotion as attendance.
    const db = new DatabaseManager(':memory:');
    concludedEvent(db, chatId, 'Pending', '2026-01-01T18:00:00.000Z', [[userId, 'pending_promotion']]);
    concludedEvent(db, chatId, 'Waitlisted', '2026-01-08T18:00:00.000Z', [[userId, 'waitlisted']]);
    concludedEvent(db, chatId, 'Withdrawn', '2026-01-15T18:00:00.000Z', [[userId, 'withdrawn']]);

    expect(db.getParticipationHistory(chatId, userId).map(r => r.participated)).toEqual([1, 0, 0]);
    db.close();
  });

  it('ignores cancelled events entirely', () => {
    const db = new DatabaseManager(':memory:');
    const cancelledId = Number(db.createEvent(chatId, 'Cancelled', 10, true, adminId, '2026-01-08T18:00:00.000Z', 'UTC'));
    db.cancelEvent(cancelledId);
    concludedEvent(db, chatId, 'Played', '2026-01-01T18:00:00.000Z', [[userId, 'joined']]);

    const rows = db.getParticipationHistory(chatId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurred_at).toBe('2026-01-01T18:00:00.000Z');
    db.close();
  });

  it('ignores untimed events, so missing one cannot break a streak', () => {
    const db = new DatabaseManager(':memory:');
    concludedEvent(db, chatId, 'Timed', '2026-01-01T18:00:00.000Z', [[userId, 'joined']]);
    const untimedId = Number(db.createEvent(chatId, 'Untimed', 10, true, adminId));
    db.concludeEvent(untimedId);

    const rows = db.getParticipationHistory(chatId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.participated).toBe(1);
    db.close();
  });

  it('ignores still-active events', () => {
    const db = new DatabaseManager(':memory:');
    const activeId = Number(db.createEvent(chatId, 'Active', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(activeId, userId, userId, 'joined');

    expect(db.getParticipationHistory(chatId, userId)).toEqual([]);
    db.close();
  });

  it('scopes history to the requested group', () => {
    const db = new DatabaseManager(':memory:');
    concludedEvent(db, chatId, 'Here', '2026-01-01T18:00:00.000Z', [[userId, 'joined']]);
    concludedEvent(db, otherChatId, 'Elsewhere', '2026-01-02T18:00:00.000Z', [[userId, 'joined']]);

    expect(db.getParticipationHistory(chatId, userId)).toHaveLength(1);
    expect(db.getParticipationHistory(otherChatId, userId)).toHaveLength(1);
    db.close();
  });

  it('returns one row per event even if a user has several participant rows', () => {
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Rejoined', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(eventId, userId, userId, 'withdrawn');
    db.addParticipant(eventId, userId, userId, 'joined');
    db.concludeEvent(eventId);

    const rows = db.getParticipationHistory(chatId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.participated).toBe(1);
    db.close();
  });
});

describe('DatabaseManager concludeEvent settles pending promotions', () => {
  const chatId = 'settle@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const ana = 'ana@s.whatsapp.net';
  const bob = 'bob@s.whatsapp.net';

  function statusOf(db: DatabaseManager, eventId: number, userId: string): string | undefined {
    const row = (db as any).db
      .prepare('SELECT status FROM participants WHERE event_id = ? AND user_id = ?')
      .get(eventId, userId) as { status: string } | undefined;
    return row?.status;
  }

  it('settles a kept promotion as joined', () => {
    // Ana was offered a freed spot and never declined it, so she kept it: she
    // held a slot nobody else could take, was listed as a participant and was
    // drawn into the teams. Attendance history must agree with that.
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Match', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(eventId, ana, 'Ana', 'pending_promotion');

    db.concludeEvent(eventId);

    expect(statusOf(db, eventId, ana)).toBe('joined');
    expect(db.getParticipationHistory(chatId, ana).map(r => r.participated)).toEqual([1]);
    db.close();
  });

  it('leaves other statuses alone', () => {
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Match', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(eventId, ana, 'Ana', 'waitlisted');
    db.addParticipant(eventId, bob, 'Bob', 'withdrawn');

    db.concludeEvent(eventId);

    expect(statusOf(db, eventId, ana)).toBe('waitlisted');
    expect(statusOf(db, eventId, bob)).toBe('withdrawn');
    expect(db.getParticipationHistory(chatId, ana).map(r => r.participated)).toEqual([0]);
    expect(db.getParticipationHistory(chatId, bob).map(r => r.participated)).toEqual([0]);
    db.close();
  });

  it('does not touch pending promotions on other events', () => {
    const db = new DatabaseManager(':memory:');
    const done = Number(db.createEvent(chatId, 'Done', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    const open = Number(db.createEvent(chatId, 'Open', 10, true, adminId, '2026-02-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(done, ana, 'Ana', 'pending_promotion');
    db.addParticipant(open, ana, 'Ana', 'pending_promotion');

    db.concludeEvent(done);

    expect(statusOf(db, done, ana)).toBe('joined');
    expect(statusOf(db, open, ana)).toBe('pending_promotion');
    db.close();
  });

  it('leaves a declined promotion out of history', () => {
    // Declining turns the row into withdrawn before the event concludes, so
    // there is nothing left to settle.
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Match', 10, true, adminId, '2026-01-01T18:00:00.000Z', 'UTC'));
    db.addParticipant(eventId, ana, 'Ana', 'pending_promotion');
    db.withdrawParticipant(eventId, ana);

    db.concludeEvent(eventId);

    expect(statusOf(db, eventId, ana)).toBe('withdrawn');
    expect(db.getParticipationHistory(chatId, ana).map(r => r.participated)).toEqual([0]);
    db.close();
  });
});

describe('DatabaseManager cheer settlement tracking', () => {
  const chatId = 'cheered@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const ana = 'ana@s.whatsapp.net';
  const bob = 'bob@s.whatsapp.net';

  it('reports unsettled before anything is recorded', () => {
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Match', 5, true, adminId));
    db.addParticipant(eventId, ana, 'Ana', 'joined');

    expect(db.isCheerResolved(eventId, ana)).toBe(false);
    db.close();
  });

  it('remembers a settled cheer', () => {
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Match', 5, true, adminId));
    db.addParticipant(eventId, ana, 'Ana', 'joined');

    db.markCheerResolved(eventId, ana);

    expect(db.isCheerResolved(eventId, ana)).toBe(true);
    db.close();
  });

  it('remembers the settlement after the user withdraws and rejoins', () => {
    // Rejoining inserts a fresh row, so the lookup has to span withdrawn rows.
    const db = new DatabaseManager(':memory:');
    const eventId = Number(db.createEvent(chatId, 'Match', 5, true, adminId));
    db.addParticipant(eventId, ana, 'Ana', 'joined');
    db.markCheerResolved(eventId, ana);
    db.withdrawParticipant(eventId, ana);
    db.addParticipant(eventId, ana, 'Ana', 'joined');

    expect(db.isCheerResolved(eventId, ana)).toBe(true);
    db.close();
  });

  it('keeps settlement records separate per user and per event', () => {
    const db = new DatabaseManager(':memory:');
    const first = Number(db.createEvent(chatId, 'First', 5, true, adminId));
    db.addParticipant(first, ana, 'Ana', 'joined');
    db.addParticipant(first, bob, 'Bob', 'joined');
    db.concludeEvent(first);
    const second = Number(db.createEvent(chatId, 'Second', 5, true, adminId));
    db.addParticipant(second, ana, 'Ana', 'joined');

    db.markCheerResolved(first, ana);

    expect(db.isCheerResolved(first, ana)).toBe(true);
    expect(db.isCheerResolved(first, bob)).toBe(false);
    expect(db.isCheerResolved(second, ana)).toBe(false);
    db.close();
  });
});

describe('DatabaseManager schema v4 migration', () => {
  const testDbPath = path.join(process.cwd(), 'test-migration-v4.db');

  it('adds cheer_resolved_at to a database created before the column existed', () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    // A v3 database: every earlier migration applied, but no cheered_at.
    const legacyDb = new Database(testDbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, title TEXT NOT NULL,
        slots INTEGER NOT NULL, waitlist_enabled INTEGER DEFAULT 1, created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        event_at TEXT, timezone TEXT, close_and_group_offset_min INTEGER,
        groups_triggered INTEGER DEFAULT 0, last_reminder_date TEXT
      );
      CREATE TABLE participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, user_id TEXT NOT NULL,
        user_name TEXT NOT NULL, status TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        invited_by TEXT, invited_by_name TEXT, join_source TEXT
      );
      CREATE TABLE chat_settings (
        chat_id TEXT PRIMARY KEY, locale TEXT NOT NULL DEFAULT 'en', reminders_enabled INTEGER DEFAULT 1
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '3');
    `);
    legacyDb.exec(`INSERT INTO events (chat_id, title, slots, created_by) VALUES ('c@g.us', 'Legacy', 5, 'a@s.whatsapp.net');`);
    legacyDb.exec(`INSERT INTO participants (event_id, user_id, user_name, status) VALUES (1, 'ana@s.whatsapp.net', 'Ana', 'joined');`);
    legacyDb.close();

    const dbManager = new DatabaseManager(testDbPath);

    const columns = ((dbManager as any).db.prepare('PRAGMA table_info(participants)').all() as any[]).map(c => c.name);
    expect(columns).toContain('cheer_resolved_at');

    // The existing participant carries no settlement record, so a cheer is still due.
    expect(dbManager.isCheerResolved(1, 'ana@s.whatsapp.net')).toBe(false);

    dbManager.close();

    // Reopening must not retry the ALTER: a second attempt would abort with
    // "duplicate column name" from inside the constructor.
    const reopened = new DatabaseManager(testDbPath);
    expect(reopened.isCheerResolved(1, 'ana@s.whatsapp.net')).toBe(false);
    reopened.close();

    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });
});

describe('DatabaseManager getParticipationHistory status filter', () => {
  const chatId = 'statuses@g.us';
  const adminId = 'admin@s.whatsapp.net';
  const ana = 'ana@s.whatsapp.net';

  /** Inserts an event, signs Ana up, then forces an arbitrary event status. */
  function eventWithStatus(db: DatabaseManager, status: string, eventAt: string): number {
    const id = Number(db.createEvent(chatId, `Event ${status}`, 10, true, adminId, eventAt, 'UTC'));
    db.addParticipant(id, ana, 'Ana', 'joined');
    (db as any).db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, id);
    return id;
  }

  it('counts concluded events only', () => {
    const db = new DatabaseManager(':memory:');
    eventWithStatus(db, 'concluded', '2026-01-01T18:00:00.000Z');
    eventWithStatus(db, 'active', '2026-01-08T18:00:00.000Z');
    eventWithStatus(db, 'cancelled', '2026-01-15T18:00:00.000Z');

    const rows = db.getParticipationHistory(chatId, ana);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurred_at).toBe('2026-01-01T18:00:00.000Z');
    db.close();
  });

  it('ignores an unrecognised status rather than guessing', () => {
    // 'completed' was in the status type since the first commit but was never
    // written by any version, so history no longer looks for it. A row carrying
    // it could only come from outside the app, and is treated as not concluded.
    const db = new DatabaseManager(':memory:');
    eventWithStatus(db, 'completed', '2026-01-01T18:00:00.000Z');

    expect(db.getParticipationHistory(chatId, ana)).toEqual([]);
    db.close();
  });
});
