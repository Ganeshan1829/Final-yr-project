-- Migration 006: Teacher-aware, demand-aware allocation
-- Student demand is NOT duplicated: it is derived from student_choices / students (existing tables).
-- Teacher capacity is derived from staff (hours) + teacher_preferences (class size).

-- 1. Teacher preferences / feedback-derived limits.
--    subject_code = '*' means "applies to every subject the teacher teaches".
--    preferred/min/max are PREFERENCES; max_class_size is only exceeded when admin_override_max is set.
CREATE TABLE IF NOT EXISTS teacher_preferences (
  staff_id TEXT NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL DEFAULT '*',
  preferred_class_size INTEGER,
  max_class_size INTEGER,
  subject_experience_years REAL,
  lab_suitability INTEGER CHECK (lab_suitability IS NULL OR lab_suitability BETWEEN 1 AND 5),
  admin_override_max INTEGER,
  source TEXT NOT NULL DEFAULT 'feedback' CHECK (source IN ('feedback', 'admin', 'synthetic')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (staff_id, subject_code)
);

-- 2. Per-term teacher feedback about a class they taught.
CREATE TABLE IF NOT EXISTS teacher_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id TEXT NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  class_size INTEGER NOT NULL,
  overcrowded INTEGER NOT NULL DEFAULT 0,
  interaction_quality INTEGER CHECK (interaction_quality IS NULL OR interaction_quality BETWEEN 1 AND 5),
  allocation_success INTEGER CHECK (allocation_success IS NULL OR allocation_success BETWEEN 1 AND 5),
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'feedback' CHECK (source IN ('feedback', 'admin', 'synthetic')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_feedback_staff ON teacher_feedback(staff_id);

-- 3. Past allocations (actual class sizes per teacher/subject/year).
CREATE TABLE IF NOT EXISTS historical_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  class_size INTEGER NOT NULL,
  attendance_rate REAL,
  room_capacity INTEGER,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (academic_year, subject_code, staff_id)
);

-- 4. ML recommendations. Written by the BACKEND after calling the ML service; ML itself never writes here.
CREATE TABLE IF NOT EXISTS class_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  predicted_students REAL NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_predictions_key ON class_predictions(subject_code, staff_id);

-- 5. Explainability for each generated section (JSON: preferred, max, ml_expected, demand, rule used).
ALTER TABLE sections ADD COLUMN allocation_basis TEXT;
