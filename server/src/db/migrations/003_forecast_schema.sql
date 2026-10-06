-- Migration 003: Forecast and Machine Learning Schema
-- Supports Demand Forecast (Phase 2, optional) with XGBoost

CREATE TABLE IF NOT EXISTS enrollment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  department TEXT NOT NULL,
  semester_no INTEGER NOT NULL,
  subject_code TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  course_type TEXT NOT NULL,
  cohort_size INTEGER NOT NULL,
  industry_demand_index REAL,
  prev_year_registered REAL,
  prev2_year_registered REAL,
  registered_trend_3y REAL,
  staff_available INTEGER,
  registered_students INTEGER,
  sections_opened INTEGER,
  avg_section_size REAL,
  is_synthetic INTEGER NOT NULL DEFAULT 1,
  credits INTEGER NOT NULL DEFAULT 3,
  has_lab INTEGER NOT NULL DEFAULT 0,
  topic_category TEXT,
  topic_trend_index REAL,
  rival_elective_trend REAL,
  dept_placement_rate_prev REAL,
  prereq_pass_rate REAL,
  course_age_years INTEGER,
  is_first_offering INTEGER NOT NULL DEFAULT 0,
  covid_flag INTEGER NOT NULL DEFAULT 0,
  staff_shortfall INTEGER NOT NULL DEFAULT 0,
  split TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(academic_year, term, department, subject_code)
);
CREATE INDEX IF NOT EXISTS idx_enrollment_year ON enrollment_history(academic_year);
CREATE INDEX IF NOT EXISTS idx_enrollment_subj ON enrollment_history(subject_code, academic_year);

CREATE TABLE IF NOT EXISTS forecast_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  target_year TEXT NOT NULL,
  train_years_json TEXT NOT NULL,
  val_year TEXT NOT NULL,
  mae REAL NOT NULL,
  rmse REAL NOT NULL,
  r2 REAL NOT NULL,
  baseline_mae REAL NOT NULL,
  core_mae REAL,
  elective_mae REAL,
  beats_baseline INTEGER NOT NULL DEFAULT 0,
  pct_improvement REAL,
  feature_importances_json TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
);
CREATE INDEX IF NOT EXISTS idx_runs_target_year ON forecast_runs(target_year);

CREATE TABLE IF NOT EXISTS forecast_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  department TEXT NOT NULL,
  semester_no INTEGER NOT NULL,
  subject_code TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  course_type TEXT NOT NULL,
  cohort_size INTEGER NOT NULL,
  predicted_registered INTEGER NOT NULL,
  low_interval INTEGER NOT NULL,
  high_interval INTEGER NOT NULL,
  predicted_sections INTEGER NOT NULL,
  last_year_actual INTEGER,
  change_pct REAL,
  staff_available INTEGER,
  sections_needed INTEGER,
  is_staff_shortfall INTEGER NOT NULL DEFAULT 0,
  is_synthetic INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_predictions_run ON forecast_predictions(run_id);

CREATE TABLE IF NOT EXISTS model_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  file_path TEXT NOT NULL,
  train_years_json TEXT NOT NULL,
  val_year TEXT NOT NULL,
  val_mae REAL NOT NULL,
  val_rmse REAL NOT NULL,
  val_r2 REAL NOT NULL,
  baseline_mae REAL NOT NULL,
  is_champion INTEGER NOT NULL DEFAULT 0,
  promoted_at TEXT,
  promoted_by TEXT
);

CREATE TABLE IF NOT EXISTS forecast_subject_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ml_subject_code TEXT NOT NULL UNIQUE,
  ml_subject_name TEXT NOT NULL,
  engine_subject_code TEXT,
  engine_subject_name TEXT,
  match_confidence REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'auto_matched',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecast_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
