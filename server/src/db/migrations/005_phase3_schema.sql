-- Migration 005: Phase 3 Management Changes & Chatbot Schema

-- 1. Changes table (stores draft, previewed, applied, reverted management changes)
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('leave', 'event', 'intake')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'previewed', 'applied', 'reverted', 'discarded')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  impact_summary TEXT,
  stale_token TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_status ON changes(status);
CREATE INDEX IF NOT EXISTS idx_changes_type ON changes(type);

-- 2. Management Change Log table (captures before/after states for reliable revert)
CREATE TABLE IF NOT EXISTS management_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  changed_by TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('apply', 'revert')),
  before_state TEXT NOT NULL,
  after_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mgt_change_log_change ON management_change_log(change_id);

-- 3. Chat Messages table (stores assistant conversations)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_call TEXT,
  tool_result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

-- 4. Audit Log table (tracks all tool invocations and security checks)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  role TEXT NOT NULL,
  tool TEXT NOT NULL,
  arguments TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'denied', 'error')),
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
