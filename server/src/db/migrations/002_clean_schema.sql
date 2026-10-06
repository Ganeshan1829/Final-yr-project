-- Migration 002: Clean Schema for Module 2 ETL & Downstream Timetable Generation

CREATE TABLE IF NOT EXISTS etl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
  stale INTEGER NOT NULL DEFAULT 0,
  rows_in_json TEXT,
  rows_out_json TEXT,
  error_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS etl_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES etl_runs(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  dataset TEXT NOT NULL,
  row_number INTEGER,
  column_name TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('error','warning')),
  action_taken TEXT,
  original_value TEXT,
  new_value TEXT,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_run ON etl_issues(run_id, severity, dataset);

CREATE TABLE IF NOT EXISTS subjects (
  subject_code TEXT PRIMARY KEY,
  subject_name TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('theory','lab')),
  credits INTEGER,
  hours_per_week INTEGER NOT NULL CHECK (hours_per_week > 0),
  total_hours INTEGER NOT NULL,
  lab_block_periods INTEGER NOT NULL,
  required_room_type TEXT NOT NULL CHECK (required_room_type IN ('classroom','computer_lab')),
  department TEXT,
  semester INTEGER
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  room_name TEXT NOT NULL,
  building TEXT,
  floor INTEGER,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  room_type TEXT NOT NULL CHECK (room_type IN ('classroom','computer_lab','seminar_hall','auditorium')),
  has_projector INTEGER NOT NULL DEFAULT 0,
  is_ac INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','maintenance'))
);

CREATE TABLE IF NOT EXISTS staff (
  staff_id TEXT PRIMARY KEY,
  staff_name TEXT NOT NULL,
  designation TEXT,
  department TEXT,
  email TEXT,
  max_hours_per_week INTEGER NOT NULL,
  hours_committed_elsewhere INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff_subjects (
  staff_id TEXT NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL REFERENCES subjects(subject_code) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, subject_code)
);

CREATE TABLE IF NOT EXISTS students (
  student_id TEXT PRIMARY KEY,
  roll_no TEXT,
  student_name TEXT NOT NULL,
  department TEXT NOT NULL,
  year INTEGER,
  semester INTEGER
);

CREATE TABLE IF NOT EXISTS student_choices (
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL REFERENCES subjects(subject_code),
  staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  selected_at TEXT,
  selection_order INTEGER,
  PRIMARY KEY (student_id, subject_code)
);

CREATE TABLE IF NOT EXISTS holidays_clean (
  holiday_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  type TEXT NOT NULL,
  applies_to TEXT,
  ignored INTEGER NOT NULL DEFAULT 0
);

-- Filled by later modules. Created now so the schema is complete.
CREATE TABLE IF NOT EXISTS sections (
  section_id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_code TEXT NOT NULL REFERENCES subjects(subject_code),
  staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  section_label TEXT,
  size INTEGER NOT NULL,
  room_id TEXT REFERENCES rooms(room_id)
);

CREATE TABLE IF NOT EXISTS timetable_slots (
  slot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  period INTEGER NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  UNIQUE (day_of_week, period, room_id)
);

CREATE TABLE IF NOT EXISTS calendar_sessions (
  session_id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  period INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor TEXT,
  kind TEXT NOT NULL,
  detail_json TEXT
);
