-- Migration 007: allow the 'reallocation' change type (teacher/student redistribution previews).
-- SQLite cannot alter a CHECK constraint, so `changes` is rebuilt. management_change_log has
-- ON DELETE CASCADE to changes, so it is backed up and restored to avoid losing history.

CREATE TABLE changes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('leave', 'event', 'intake', 'reallocation')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'previewed', 'applied', 'reverted', 'discarded')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  impact_summary TEXT,
  stale_token TEXT
);
INSERT INTO changes_new (id, type, payload, status, created_by, created_at, applied_at, impact_summary, stale_token)
  SELECT id, type, payload, status, created_by, created_at, applied_at, impact_summary, stale_token FROM changes;

CREATE TABLE management_change_log_backup AS SELECT * FROM management_change_log;
DROP TABLE management_change_log;
DROP TABLE changes;
ALTER TABLE changes_new RENAME TO changes;

CREATE TABLE management_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  changed_by TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('apply', 'revert')),
  before_state TEXT NOT NULL,
  after_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO management_change_log (id, change_id, changed_by, action, before_state, after_state, created_at)
  SELECT id, change_id, changed_by, action, before_state, after_state, created_at FROM management_change_log_backup;
DROP TABLE management_change_log_backup;

CREATE INDEX IF NOT EXISTS idx_changes_status ON changes(status);
CREATE INDEX IF NOT EXISTS idx_changes_type ON changes(type);
CREATE INDEX IF NOT EXISTS idx_mgt_change_log_change ON management_change_log(change_id);
