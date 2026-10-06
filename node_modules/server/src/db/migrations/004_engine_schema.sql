-- Migration 004: Timetable Engine Schema (Module 3)

-- 1. Alter existing sections table to add engine columns
ALTER TABLE sections ADD COLUMN required_room_type TEXT DEFAULT 'classroom';
ALTER TABLE sections ADD COLUMN hours_per_week INTEGER DEFAULT 3;
ALTER TABLE sections ADD COLUMN is_lab INTEGER DEFAULT 0;
ALTER TABLE sections ADD COLUMN warning_message TEXT;
ALTER TABLE sections ADD COLUMN created_at TEXT;

-- 2. section_students table
CREATE TABLE IF NOT EXISTS section_students (
  section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  PRIMARY KEY (section_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_sec_stu_sec ON section_students(section_id);
CREATE INDEX IF NOT EXISTS idx_sec_stu_stu ON section_students(student_id);

-- 3. solver_runs table
CREATE TABLE IF NOT EXISTS solver_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  objective REAL,
  wall_time REAL,
  created_at TEXT NOT NULL,
  params TEXT,
  diagnosis TEXT,
  clash_count INTEGER DEFAULT 0,
  wasted_seats INTEGER DEFAULT 0
);

-- 4. Alter existing timetable_slots table to add engine columns
ALTER TABLE timetable_slots ADD COLUMN subject_code TEXT;
ALTER TABLE timetable_slots ADD COLUMN staff_id TEXT;
ALTER TABLE timetable_slots ADD COLUMN is_lab_block INTEGER DEFAULT 0;
ALTER TABLE timetable_slots ADD COLUMN run_id INTEGER REFERENCES solver_runs(id);
ALTER TABLE timetable_slots ADD COLUMN is_pinned INTEGER DEFAULT 0;

-- 5. Alter existing calendar_sessions table to add engine columns
ALTER TABLE calendar_sessions ADD COLUMN subject_code TEXT;
ALTER TABLE calendar_sessions ADD COLUMN staff_id TEXT;
ALTER TABLE calendar_sessions ADD COLUMN day_of_week INTEGER;
ALTER TABLE calendar_sessions ADD COLUMN notes TEXT;

-- 6. suggested_makeups table
CREATE TABLE IF NOT EXISTS suggested_makeups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  makeup_date TEXT NOT NULL,
  period INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('suggested', 'approved', 'rejected')),
  created_at TEXT NOT NULL
);

-- 7. hours_summary table
CREATE TABLE IF NOT EXISTS hours_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  required_hours INTEGER NOT NULL,
  delivered_hours INTEGER NOT NULL,
  shortfall_hours INTEGER NOT NULL,
  makeup_approved_hours INTEGER NOT NULL DEFAULT 0,
  UNIQUE (section_id)
);

-- 8. engine_state table
CREATE TABLE IF NOT EXISTS engine_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  split_status TEXT NOT NULL DEFAULT 'not_run',
  solve_status TEXT NOT NULL DEFAULT 'not_run',
  calendar_status TEXT NOT NULL DEFAULT 'not_run',
  stale INTEGER NOT NULL DEFAULT 0,
  split_error TEXT,
  solve_error TEXT,
  last_split_at TEXT,
  last_solve_at TEXT,
  last_calendar_at TEXT
);
INSERT OR IGNORE INTO engine_state (id, split_status, solve_status, calendar_status, stale)
VALUES (1, 'not_run', 'not_run', 'not_run', 0);
