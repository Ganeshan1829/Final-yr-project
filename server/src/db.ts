import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './db/migrationRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the canonical server data directory exists.
// APP_DATA_DIR lets tests (and deployments) keep the database, uploads and exports out of the dev folders.
const dataDir = process.env.APP_DATA_DIR ? path.resolve(process.env.APP_DATA_DIR, 'data') : path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
export const db = new DatabaseSync(dbPath);

// Enable foreign keys, WAL mode, and busy timeout
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset TEXT UNIQUE NOT NULL,
      original_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      report_json TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dataset_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER NOT NULL,
      row_index INTEGER NOT NULL,
      row_json TEXT NOT NULL,
      FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dataset_rows_upload ON dataset_rows(upload_id);

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      rules_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holiday_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      type TEXT NOT NULL,
      applies_to TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      event_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      date TEXT NOT NULL,
      start_period INTEGER NOT NULL,
      end_period INTEGER NOT NULL,
      venue_room_id TEXT NOT NULL,
      staff_involved TEXT NOT NULL,
      student_scope TEXT NOT NULL,
      expected_attendance INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leave (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leave_id TEXT UNIQUE NOT NULL,
      staff_id TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Run clean schema migrations
  runMigrations(db);
}

// Automatically initialize tables on import
initDatabase();


