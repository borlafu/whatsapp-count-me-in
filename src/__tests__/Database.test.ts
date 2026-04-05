import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../Database.js';
import fs from 'fs';
import path from 'path';

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
