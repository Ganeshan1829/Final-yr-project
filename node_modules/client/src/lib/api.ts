export interface ValidationReport {
  dataset: string;
  fileName: string;
  rowCount: number;
  fileSizeBytes: number;
  headersFound: string[];
  expectedColumns: string[];
  missingColumns: string[];
  unexpectedColumns: string[];
  keyColumnEmptyCounts: Record<string, number>;
  columnSummaries: Record<
    string,
    {
      column: string;
      emptyCount: number;
      invalidEnumCount?: number;
      invalidEnumExamples?: string[];
    }
  >;
  errors: string[];
  warnings: string[];
  isValid: boolean;
  status: 'Uploaded' | 'Has issues';
}

export interface DatasetItem {
  id: string;
  name: string;
  description: string;
  isRequired: boolean;
  expectedColumns: string[];
  keyColumns: string[];
  isUploaded: boolean;
  status: 'Uploaded' | 'Has issues' | 'Not uploaded';
  fileName: string | null;
  rowCount: number;
  uploadedAt: string | null;
  report: ValidationReport | null;
}

export interface ReadinessItem {
  id: string;
  name: string;
  isRequired: boolean;
  isCompleted: boolean;
  status: 'Uploaded' | 'Configured' | 'Has issues' | 'Not configured' | 'Not uploaded';
  fileName: string | null;
  rowCount: number;
  updatedAt: string | null;
  missingColumns: string[];
  issuesCount: number;
}

export interface ReadinessData {
  completedRequiredCount: number;
  totalRequiredCount: number;
  percentage: number;
  isReadyForValidation: boolean;
  items: ReadinessItem[];
}

export interface RulePeriod {
  period: number;
  start: string;
  end: string;
}

export interface RulesData {
  semester_name: string;
  academic_year: string;
  department: string;
  semester_start: string;
  semester_end: string;
  working_days: string[];
  saturday_makeup_allowed: boolean;
  periods_per_day: number;
  periods: RulePeriod[];
  teaching_weeks_planned: number;
  default_section_size: number;
  min_section_size: number;
  max_section_size: number;
  max_consecutive_theory_periods: number;
  max_staff_periods_per_day: number;
  timezone: string;
}

export interface HolidayRecord {
  id: number;
  holiday_id: string;
  name: string;
  date_from: string;
  date_to: string;
  type: 'public_holiday' | 'institution_holiday' | 'internal_exam';
  applies_to: string;
  created_at: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data?.error?.message || `Request failed with status ${res.status}`;
    const err = new Error(errorMsg) as any;
    err.code = data?.error?.code;
    err.details = data?.error?.details;
    throw err;
  }

  return data as T;
}

export const api = {
  // Readiness
  getReadiness: () => request<ReadinessData>('/api/readiness'),

  // Datasets
  getDatasets: () => request<{ datasets: DatasetItem[] }>('/api/datasets'),
  
  getSchemas: () => request<any>('/api/schemas'),

  uploadDataset: (name: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ success: boolean; dataset: string; status: 'Uploaded' | 'Has issues'; rowCount: number; report: ValidationReport }>(
      `/api/datasets/${name}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  getDatasetPreview: (name: string, limit = 25) =>
    request<{
      dataset: string;
      original_filename: string;
      totalRows: number;
      previewRows: Record<string, any>[];
      status: 'Uploaded' | 'Has issues';
      uploaded_at: string;
      report: ValidationReport;
    }>(`/api/datasets/${name}/preview?limit=${limit}`),

  deleteDataset: (name: string) =>
    request<{ success: boolean; message: string }>(`/api/datasets/${name}`, {
      method: 'DELETE',
    }),

  downloadTemplateUrl: (name: string) => `/api/datasets/${name}/template`,

  // Rules
  getRules: () =>
    request<{ configured: boolean; rules: RulesData | null; updatedAt: string | null }>('/api/rules'),

  saveRules: (rules: RulesData) =>
    request<{ success: boolean; rules: RulesData; message: string }>('/api/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    }),

  importRulesCsv: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ success: boolean; rules: RulesData; message: string }>('/api/rules/import', {
      method: 'POST',
      body: formData,
    });
  },

  exportRulesUrl: () => '/api/rules/export',

  // Holidays
  getHolidays: () =>
    request<{
      holidays: HolidayRecord[];
      semesterRules: { semester_start: string; semester_end: string; semester_name: string } | null;
    }>('/api/holidays'),

  createHoliday: (data: Omit<HolidayRecord, 'id' | 'created_at'>) =>
    request<{ success: boolean; holiday: HolidayRecord; message: string }>('/api/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateHoliday: (id: number, data: Partial<HolidayRecord>) =>
    request<{ success: boolean; holiday: HolidayRecord; message: string }>(`/api/holidays/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteHoliday: (id: number) =>
    request<{ success: boolean; message: string }>(`/api/holidays/${id}`, {
      method: 'DELETE',
    }),

  importHolidaysCsv: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ success: boolean; count: number; holidays: HolidayRecord[]; message: string }>(
      '/api/holidays/import',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  // Sample data loader
  loadSampleData: () =>
    request<{ success: boolean; message: string; loaded: Record<string, any> }>('/api/sample/load', {
      method: 'POST',
    }),

  // ETL / Validation (Module 2)
  runEtl: () =>
    request<{ runId: number; status: 'passed' | 'failed'; summary: EtlRunSummary }>('/api/etl/run', {
      method: 'POST',
    }),

  getLatestEtlRun: () =>
    request<{ run: (EtlRunRecord & { isStale?: boolean }) | null; summary?: EtlRunSummary | null }>('/api/etl/latest'),

  getEtlRuns: () =>
    request<{ runs: EtlRunRecord[] }>('/api/etl/runs'),

  getEtlRun: (id: number) =>
    request<{ run: EtlRunRecord; summary?: EtlRunSummary | null }>(`/api/etl/runs/${id}`),

  getEtlRules: () =>
    request<{ rules: RuleCatalogItem[] }>('/api/etl/rules'),

  getEtlIssues: (
    runId: number,
    params: {
      severity?: string;
      dataset?: string;
      rule?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ) => {
    const query = new URLSearchParams();
    if (params.severity) query.set('severity', params.severity);
    if (params.dataset) query.set('dataset', params.dataset);
    if (params.rule) query.set('rule', params.rule);
    if (params.q) query.set('q', params.q);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    const qs = query.toString();
    return request<{
      runId: number;
      issues: EtlIssueItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/etl/runs/${runId}/issues${qs ? `?${qs}` : ''}`);
  },

  issuesCsvUrl: (runId: number) => `/api/etl/runs/${runId}/issues.csv`,

  // Clean data inspection and exports
  getCleanSummary: () =>
    request<{
      lastPassedRunId: number | null;
      lastPassedAt: string | null;
      counts: Record<string, number>;
    }>('/api/clean/summary'),

  getCleanDataset: (dataset: string, page = 1, pageSize = 50) =>
    request<{
      dataset: string;
      rows: Record<string, any>[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/clean/${dataset}?page=${page}&pageSize=${pageSize}`),

  cleanDatasetCsvUrl: (dataset: string) => `/api/clean/${dataset}.csv`,

  // Demand Forecast (Phase 2, optional)
  getForecastStatus: () => request<ForecastStatusData>('/api/forecast/status'),

  seedForecastHistory: () =>
    request<{ success: boolean; message: string; years: string[]; total_rows: number }>(
      '/api/forecast/history/seed',
      { method: 'POST' }
    ),

  uploadFinishedYearActuals: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ success: boolean; message: string; years_imported: string[]; rowCount: number }>(
      '/api/forecast/history/import',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  forecastHistoryTemplateUrl: () => '/api/forecast/history/template',

  trainForecastModel: (targetYear = '2026-27', forcePromote = false) =>
    request<{
      run_id: number;
      model_version: string;
      is_champion: boolean;
      metrics: ForecastMetrics;
    }>('/api/forecast/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_year: targetYear, force_promote: forcePromote }),
    }),

  getForecastInputs: (targetYear = '2026-27') =>
    request<{ target_year: string; inputs: ForecastInputRecord[]; count: number }>(
      `/api/forecast/inputs?target_year=${targetYear}`
    ),

  saveForecastInputs: (inputs: ForecastInputRecord[], targetYear = '2026-27') =>
    request<{ success: boolean; message: string; count: number }>(
      `/api/forecast/inputs?target_year=${targetYear}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      }
    ),

  runForecastPredictions: (targetYear = '2026-27', sectionSize = 30) =>
    request<{
      run_id: number;
      target_year: string;
      model_version: string;
      count: number;
      total_predicted_students: number;
      total_predicted_sections: number;
      staff_shortfall_count: number;
      predictions: ForecastPredictionRecord[];
    }>('/api/forecast/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_year: targetYear, section_size: sectionSize }),
    }),

  getForecastPredictions: (targetYear?: string) =>
    request<{ predictions: ForecastPredictionRecord[]; count: number }>(
      `/api/forecast/predictions${targetYear ? `?target_year=${targetYear}` : ''}`
    ),

  getForecastSectionPlan: () =>
    request<ForecastSectionPlanItem[]>('/api/forecast/section-plan'),

  getForecastAccuracy: () =>
    request<ForecastAccuracyData>('/api/forecast/accuracy'),

  getForecastModels: () =>
    request<ForecastModelRecord[]>('/api/forecast/models'),

  promoteForecastModel: (version: string) =>
    request<{ success: boolean; message: string; version: string }>(
      `/api/forecast/models/${version}/promote`,
      { method: 'POST' }
    ),

  getForecastSubjectMap: () =>
    request<ForecastSubjectMapItem[]>('/api/forecast/subject-map'),

  updateForecastSubjectMap: (ml_subject_code: string, engine_subject_code: string) =>
    request<{ success: boolean; ml_subject_code: string; engine_subject_code: string }>(
      '/api/forecast/subject-map',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ml_subject_code, engine_subject_code }),
      }
    ),

  forecastRunExportCsvUrl: (runId: number) => `/api/forecast/runs/${runId}/export.csv`,

  // Module 3: Engine
  getEngineStatus: () =>
    request<{
      state: EngineState;
      python: { ready: boolean; version?: string; error?: string };
      latest_run: SolverRunSummary | null;
      validation_passed: boolean;
    }>('/api/engine/status'),

  splitSections: () =>
    request<{
      success: boolean;
      total_sections: number;
      total_students_assigned: number;
      warnings: string[];
      errors: string[];
      sections: SplitSectionItem[];
    }>('/api/engine/split', { method: 'POST' }),

  getSections: () =>
    request<{ count: number; sections: SplitSectionItem[] }>('/api/engine/sections'),

  editSectionSize: (sectionId: number, size: number, confirm: boolean = false) =>
    request<{
      preview: boolean;
      section: any;
      old_size: number;
      new_size: number;
      room_capacity_ok: boolean;
      warnings: string[];
    }>(`/api/engine/sections/${sectionId}/edit-size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size, confirm }),
    }),

  runWeeklySolver: (time_limit_seconds = 60) =>
    request<SolverRunSummary>('/api/engine/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_limit_seconds }),
    }),

  getSolverStatus: () =>
    request<{
      isRunning: boolean;
      progress: number;
      latestResult: SolverRunSummary | null;
      error: string | null;
    }>('/api/engine/solver-status'),

  getTimetableSlots: (filters: { section_id?: number; staff_id?: string; room_id?: string; day_of_week?: number } = {}) => {
    const q = new URLSearchParams();
    if (filters.section_id) q.set('section_id', String(filters.section_id));
    if (filters.staff_id) q.set('staff_id', filters.staff_id);
    if (filters.room_id) q.set('room_id', filters.room_id);
    if (filters.day_of_week) q.set('day_of_week', String(filters.day_of_week));
    const qs = q.toString();
    return request<{ count: number; slots: TimetableSlotItem[]; latest_run: SolverRunSummary | null }>(
      `/api/engine/timetable${qs ? `?${qs}` : ''}`
    );
  },

  generateSemesterCalendar: () =>
    request<CalendarGenerationSummary>('/api/engine/calendar', { method: 'POST' }),

  getCalendarSessions: (filters: { month?: string; date?: string; section_id?: number; staff_id?: string; room_id?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (filters.month) q.set('month', filters.month);
    if (filters.date) q.set('date', filters.date);
    if (filters.section_id) q.set('section_id', String(filters.section_id));
    if (filters.staff_id) q.set('staff_id', filters.staff_id);
    if (filters.room_id) q.set('room_id', filters.room_id);
    if (filters.status) q.set('status', filters.status);
    const qs = q.toString();
    return request<{ count: number; sessions: CalendarSessionItem[] }>(
      `/api/engine/calendar${qs ? `?${qs}` : ''}`
    );
  },

  getHoursSummary: () =>
    request<{ count: number; total_shortfall_hours: number; summary: HoursSummaryItem[] }>(
      '/api/engine/hours-summary'
    ),

  getMakeups: (status?: string) =>
    request<{ count: number; makeups: SuggestedMakeupItem[] }>(
      `/api/engine/makeups${status ? `?status=${status}` : ''}`
    ),

  approveMakeup: (id: number) =>
    request<{ success: boolean; message: string; makeup: SuggestedMakeupItem }>(
      `/api/engine/makeups/${id}/approve`,
      { method: 'POST' }
    ),

  rejectMakeup: (id: number) =>
    request<{ success: boolean; message: string; makeup: SuggestedMakeupItem }>(
      `/api/engine/makeups/${id}/reject`,
      { method: 'POST' }
    ),

  exportTimetableCsvUrl: () => '/api/engine/export/timetable.csv',
  exportHoursCsvUrl: () => '/api/engine/export/hours.csv',
};

export interface EtlIssueItem {
  id: number;
  run_id: number;
  rule_code: string;
  dataset: string;
  row_number: number;
  column_name: string | null;
  severity: 'error' | 'warning';
  action_taken: string | null;
  original_value: string | null;
  new_value: string | null;
  message: string;
}

export interface RuleCatalogItem {
  code: string;
  dataset: string;
  severity: 'error' | 'warning';
  description: string;
}

export interface EtlRunSummary {
  rowsIn: number;
  rowsOut: number;
  duplicatesRemoved: number;
  autoFixes: number;
  warnings: number;
  errors: number;
  byRule: Record<string, number>;
  byDataset: Record<
    string,
    {
      rowsIn: number;
      rowsOut: number;
      errors: number;
      warnings: number;
    }
  >;
}

export interface EtlRunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'passed' | 'failed';
  stale: number;
  isStale?: boolean;
  rows_in_json: string | null;
  rows_out_json: string | null;
  error_count: number;
  warning_count: number;
}

export interface ForecastStatusData {
  is_enabled: boolean;
  history_count: number;
  available_years: string[];
  champion_model: ForecastModelRecord | null;
  latest_run: ForecastRunRecord | null;
  predictions_summary: {
    target_year: string | null;
    count: number;
  };
  is_stale: boolean;
}

export interface ForecastMetrics {
  target_year: string;
  train_years: string[];
  val_year: string;
  mae: number;
  rmse: number;
  r2: number;
  baseline_mae: number;
  core_mae: number | null;
  elective_mae: number | null;
  beats_baseline: boolean;
  pct_improvement: number;
  feature_importances: { feature: string; importance: number }[];
  best_iteration: number;
  residual_std: number;
}

export interface ForecastModelRecord {
  id: number;
  version: string;
  created_at: string;
  file_path: string;
  train_years_json: string;
  val_year: string;
  val_mae: number;
  val_rmse: number;
  val_r2: number;
  baseline_mae: number;
  is_champion: number;
  promoted_at: string | null;
  promoted_by: string | null;
}

export interface ForecastRunRecord {
  id: number;
  created_at: string;
  model_version: string;
  target_year: string;
  train_years_json: string;
  val_year: string;
  mae: number;
  rmse: number;
  r2: number;
  baseline_mae: number;
  core_mae: number | null;
  elective_mae: number | null;
  beats_baseline: number;
  pct_improvement: number | null;
  feature_importances_json: string;
  status: string;
}

export interface ForecastInputRecord {
  record_id?: string;
  academic_year: string;
  term: string;
  department: string;
  semester_no: number;
  subject_code: string;
  subject_name: string;
  course_type: string;
  cohort_size: number;
  industry_demand_index: number | null;
  prev_year_registered?: number | null;
  staff_available: number;
  credits: number;
  has_lab: number;
  topic_category?: string;
  topic_trend_index: number | null;
  is_assumed?: boolean;
}

export interface ForecastPredictionRecord {
  id?: number;
  run_id?: number;
  academic_year: string;
  term: string;
  department: string;
  semester_no: number;
  subject_code: string;
  subject_name: string;
  course_type: string;
  cohort_size: number;
  predicted_registered: number;
  low_interval: number;
  high_interval: number;
  predicted_sections: number;
  last_year_actual: number | null;
  change_pct: number | null;
  staff_available: number;
  sections_needed: number;
  is_staff_shortfall: number;
  is_synthetic: number;
}

export interface ForecastSectionPlanItem {
  subject_code: string;
  subject_name: string;
  department: string;
  term: string;
  predicted_sections: number;
  predicted_registered: number;
  staff_available: number;
  staff_shortfall: number;
}

export interface ForecastAccuracyData {
  has_data: boolean;
  message?: string;
  latest_run?: ForecastRunRecord;
  champion_model?: ForecastModelRecord;
  feature_importances?: { feature: string; importance: number }[];
  rolling_backtest?: {
    year: string;
    model_mae: number;
    baseline_mae: number;
    beats_baseline: boolean;
    improvement_pct: number;
  }[];
}

export interface ForecastSubjectMapItem {
  id: number;
  ml_subject_code: string;
  ml_subject_name: string;
  engine_subject_code: string | null;
  engine_subject_name: string | null;
  match_confidence: number;
  status: string;
  updated_at: string;
}

export interface EngineState {
  id: number;
  split_status: 'not_run' | 'completed' | 'warning' | 'error';
  solve_status: 'not_run' | 'running' | 'completed' | 'failed' | 'stale';
  calendar_status: 'not_run' | 'completed' | 'stale';
  stale: number;
  split_error: string | null;
  solve_error: string | null;
  calendar_error: string | null;
  last_split_at: string | null;
  last_solve_at: string | null;
  last_calendar_at: string | null;
}

export interface SplitSectionItem {
  section_id: number;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  section_label: string;
  size: number;
  required_room_type: string;
  hours_per_week: number;
  is_lab: number;
  warning_message: string | null;
  student_ids?: string[];
}

export interface SolverRunSummary {
  id: number;
  status: 'optimal' | 'feasible' | 'infeasible' | 'timeout' | 'error';
  objective: number | null;
  wall_time: number;
  created_at: string;
  clash_count: number;
  wasted_seats: number;
  diagnosis: string | null;
  message: string;
  slots_count: number;
}

export interface TimetableSlotItem {
  slot_id: number;
  section_id: number;
  section_label: string;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  room_id: string;
  room_name: string;
  day_of_week: number;
  period: number;
  is_lab_block: number;
  is_pinned?: number;
}

export interface CalendarSessionItem {
  session_id: number;
  section_id: number;
  section_label: string;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  room_id: string;
  room_name: string;
  session_date: string;
  day_of_week: number;
  period: number;
  status: 'scheduled' | 'skipped_holiday' | 'skipped_leave' | 'skipped_event' | 'makeup';
  notes: string | null;
}

export interface HoursSummaryItem {
  id?: number;
  section_id: number;
  section_label: string;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  required_hours: number;
  delivered_hours: number;
  shortfall_hours: number;
  makeup_approved_hours: number;
}

export interface SuggestedMakeupItem {
  id: number;
  section_id: number;
  section_label: string;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  room_id: string;
  room_name: string;
  makeup_date: string;
  period: number;
  status: 'suggested' | 'approved' | 'rejected';
  created_at: string;
}

export interface CalendarGenerationSummary {
  success: boolean;
  total_dates: number;
  total_sessions: number;
  scheduled_count: number;
  holiday_skipped_count: number;
  leave_skipped_count: number;
  event_skipped_count: number;
  makeups_suggested_count: number;
  total_shortfall_hours: number;
  hours_summary: HoursSummaryItem[];
  makeups: SuggestedMakeupItem[];
}

// =========================================================================
// PHASE 3: MANAGEMENT CHANGES & CHATBOT TYPES & API
// =========================================================================

export type ChangeType = 'leave' | 'event' | 'intake';
export type ChangeStatus = 'draft' | 'previewed' | 'applied' | 'reverted' | 'discarded';

export interface ProposedFix {
  session_id: number;
  section_id: number;
  section_label: string;
  subject_code: string;
  original_date: string;
  original_period: number;
  original_room_id: string;
  original_staff_id: string;
  action: 'move_room' | 'move_slot' | 'substitute' | 'makeup' | 'manual';
  new_room_id?: string;
  new_room_name?: string;
  new_date?: string;
  new_period?: number;
  substitute_staff_id?: string;
  substitute_staff_name?: string;
  substitute_candidates?: Array<{ staff_id: string; staff_name: string; current_load: number }>;
  makeup_date?: string;
  makeup_period?: number;
  makeup_room_id?: string;
  reason?: string;
}

export interface ImpactSummary {
  sessions_affected_count: number;
  proposed_fixes: ProposedFix[];
  unresolved_items: Array<{ session_id: number; reason: string }>;
  shortfall_before: number;
  shortfall_after: number;
  by_subject_shortfall: Array<{ subject_code: string; before: number; after: number }>;
  new_clashes: number;
  diff: Array<{
    session_id?: number;
    description: string;
    before: string;
    after: string;
  }>;
}

export interface ChangeRecord {
  id: number;
  type: ChangeType;
  payload: any;
  status: ChangeStatus;
  created_by: string;
  created_at: string;
  applied_at: string | null;
  impact_summary: ImpactSummary | null;
  stale_token: string | null;
}

export interface ChangePreviewResponse {
  change_id: number | null;
  type: ChangeType;
  payload: any;
  status: ChangeStatus;
  is_what_if: boolean;
  stale_token: string;
  impact_summary: ImpactSummary;
}

export interface ManagementAlertsResponse {
  unresolved_count: number;
  shortfall_count: number;
  unresolved_changes: Array<{
    change_id: number;
    type: ChangeType;
    created_at: string;
    unresolved_items: Array<{ session_id: number; reason: string }>;
  }>;
  shortfall_subjects: Array<{
    subject_code: string;
    subject_name: string;
    section_label: string;
    shortfall_hours: number;
  }>;
}

export interface ChatMessageItem {
  id?: number;
  session_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_call?: {
    name: string;
    arguments: any;
  };
  tool_result?: any;
  preview?: ChangePreviewResponse;
  is_what_if?: boolean;
  created_at?: string;
}

// Helpers for User Roles stored in localStorage/session
export type AppUserRole = 'student' | 'staff' | 'hod';

export function getStoredUserRole(): AppUserRole {
  return (localStorage.getItem('app_user_role') as AppUserRole) || 'hod';
}

export function setStoredUserRole(role: AppUserRole) {
  localStorage.setItem('app_user_role', role);
}

export function getStoredLanguage(): 'en' | 'ta' {
  return (localStorage.getItem('app_language') as 'en' | 'ta') || 'en';
}

export function setStoredLanguage(lang: 'en' | 'ta') {
  localStorage.setItem('app_language', lang);
}

// --- Management Changes API ---
const API_BASE_URL = '/api';

export async function previewManagementChange(
  type: ChangeType,
  payload: any,
  isWhatIf = false
): Promise<ChangePreviewResponse> {
  const role = getStoredUserRole();
  const res = await fetch(`${API_BASE_URL}/changes/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
    },
    body: JSON.stringify({ type, payload, is_what_if: isWhatIf }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Failed to preview management change');
  }
  return res.json();
}

export async function confirmManagementChange(id: number): Promise<{ success: boolean; change: ChangeRecord; validation: any }> {
  const role = getStoredUserRole();
  const res = await fetch(`${API_BASE_URL}/changes/${id}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Failed to confirm change');
  }
  return res.json();
}

export async function discardManagementChange(id: number): Promise<{ success: boolean }> {
  const role = getStoredUserRole();
  const res = await fetch(`${API_BASE_URL}/changes/${id}/discard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Failed to discard change');
  }
  return res.json();
}

export async function revertManagementChange(id: number): Promise<{ success: boolean; change: ChangeRecord; validation: any }> {
  const role = getStoredUserRole();
  const res = await fetch(`${API_BASE_URL}/changes/${id}/revert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Failed to revert change');
  }
  return res.json();
}

export async function fetchManagementChanges(status?: ChangeStatus, type?: ChangeType): Promise<ChangeRecord[]> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (type) params.append('type', type);
  const res = await fetch(`${API_BASE_URL}/changes?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch changes');
  const data = await res.json();
  return data.changes || [];
}

export async function fetchManagementChangeById(id: number): Promise<ChangeRecord> {
  const res = await fetch(`${API_BASE_URL}/changes/${id}`);
  if (!res.ok) throw new Error('Failed to fetch change detail');
  const data = await res.json();
  return data.change;
}

export async function fetchManagementAlerts(): Promise<ManagementAlertsResponse> {
  const res = await fetch(`${API_BASE_URL}/changes/alerts`);
  if (!res.ok) throw new Error('Failed to fetch management alerts');
  return res.json();
}

// --- Chatbot API ---

export async function sendChatMessage(
  message: string,
  sessionId = 'default-session'
): Promise<{
  session_id: string;
  reply: string;
  tool_call?: { name: string; arguments: any };
  tool_result?: any;
  preview?: ChangePreviewResponse;
  is_what_if?: boolean;
  language: 'en' | 'ta';
  configured: boolean;
}> {
  const role = getStoredUserRole();
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
      'x-user-id': role === 'student' ? 'STU001' : role === 'staff' ? 'STF001' : 'HOD_ADMIN',
      'x-section-id': 'CS301-A',
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Chat request failed');
  }
  return res.json();
}

export async function fetchChatHistory(sessionId = 'default-session'): Promise<ChatMessageItem[]> {
  const res = await fetch(`${API_BASE_URL}/chat/history?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error('Failed to fetch chat history');
  const data = await res.json();
  return data.messages || [];
}

export async function clearChatHistory(sessionId = 'default-session'): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE_URL}/chat/history?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to clear chat history');
  return res.json();
}

export async function fetchChatStatus(): Promise<{ configured: boolean; provider: string; model: string; mock_mode: boolean }> {
  const res = await fetch(`${API_BASE_URL}/chat/status`);
  if (!res.ok) throw new Error('Failed to fetch chat status');
  return res.json();
}

// --- Dashboard & Export Types & API ---

export interface DashboardFilters {
  department?: string;
  semester?: number;
  subject?: string;
  staff?: string;
  date_from?: string;
  date_to?: string;
}

export interface SummaryKPIs {
  timetable_status: 'generated' | 'stale' | 'not_generated';
  semester_dates: {
    semester_name: string;
    semester_start: string;
    semester_end: string;
  } | null;
  total_sections: number;
  total_weekly_periods: number;
  total_clashes: number;
  total_hours_shortfall: number;
  changes_applied_count: number;
  last_solver_run_time: string | null;
  solver_run_id: number | null;
  is_stale: boolean;
  stale_reason?: string;
}

export interface RoomUtilizationItem {
  room_id: string;
  room_name: string;
  room_type: string;
  capacity: number;
  building: string | null;
  floor: number | null;
  used_periods: number;
  available_periods: number;
  utilization_pct: number;
  status: 'underused' | 'normal' | 'overloaded';
}

export interface RoomHeatmapSlot {
  occupied: boolean;
  section_id?: number;
  section_label?: string;
  subject_code?: string;
  subject_name?: string;
  staff_id?: string;
  staff_name?: string;
  is_lab_block?: boolean;
}

export interface RoomHeatmap {
  days: string[];
  periods_per_day: number;
  rooms: {
    room_id: string;
    room_name: string;
    room_type: string;
    capacity: number;
    slots: Record<string, RoomHeatmapSlot>;
  }[];
}

export interface WastedSeatsAnalysis {
  average_wasted_seats: number;
  total_seat_periods_wasted: number;
  worst_10_mismatches: {
    day_of_week: number;
    period: number;
    room_id: string;
    room_name: string;
    room_capacity: number;
    section_id: number;
    section_label: string;
    subject_code: string;
    subject_name: string;
    section_size: number;
    wasted_seats: number;
    wasted_pct: number;
  }[];
}

export interface RoomUseResponse {
  rooms: RoomUtilizationItem[];
  heatmap: RoomHeatmap;
  wasted_seats: WastedSeatsAnalysis;
  utilization_by_type: {
    theory_avg_pct: number;
    lab_avg_pct: number;
    overall_avg_pct: number;
  };
  underused_count: number;
  overloaded_count: number;
}

export interface ClashesAnalysis {
  total_clashes: number;
  status: 'clean' | 'has_clashes';
  timetable_clashes: {
    staff_clashes: number;
    room_clashes: number;
    section_clashes: number;
    student_clashes: number;
    capacity_violations: number;
    room_type_violations: number;
    hour_mismatches: number;
    lab_block_violations: number;
    errors: string[];
  };
  calendar_clashes: {
    total_sessions: number;
    staff_clashes: number;
    room_clashes: number;
    section_clashes: number;
    capacity_violations: number;
    errors: string[];
  };
}

export interface HoursSubjectItem {
  section_id: number;
  section_label: string;
  subject_code: string;
  subject_name: string;
  department: string;
  staff_id: string;
  staff_name: string;
  required_hours: number;
  delivered_hours: number;
  shortfall_hours: number;
  makeup_approved_hours: number;
  final_shortfall: number;
  progress_pct: number;
}

export interface DepartmentShortfallItem {
  department: string;
  required_hours: number;
  delivered_hours: number;
  shortfall_hours: number;
  final_shortfall: number;
  completion_pct: number;
}

export interface MakeupStatusSummary {
  suggested_count: number;
  approved_count: number;
  rejected_count: number;
  hours_recovered: number;
}

export interface HoursAnalysisResponse {
  subjects: HoursSubjectItem[];
  departments: DepartmentShortfallItem[];
  makeup_status: MakeupStatusSummary;
  totals: {
    required_hours: number;
    delivered_hours: number;
    shortfall_hours: number;
    makeup_approved_hours: number;
    final_shortfall_hours: number;
    overall_completion_pct: number;
  };
}

export interface StaffWorkloadItem {
  staff_id: string;
  staff_name: string;
  department: string;
  max_hours_per_week: number;
  weekly_hours_scheduled: number;
  is_overloaded: boolean;
  utilization_pct: number;
}

export interface WorkloadAnalysisResponse {
  staff: StaffWorkloadItem[];
  overloaded_count: number;
  average_utilization_pct: number;
}

export interface ManagementChangesSummary {
  leave_count: number;
  event_count: number;
  intake_count: number;
  total_applied: number;
  recent_log: {
    id: number;
    type: string;
    created_at: string;
    created_by: string;
    status: string;
    summary: string;
  }[];
}

function buildQuery(filters?: DashboardFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.department) params.append('department', filters.department);
  if (filters.semester) params.append('semester', String(filters.semester));
  if (filters.subject) params.append('subject', filters.subject);
  if (filters.staff) params.append('staff', filters.staff);
  if (filters.date_from) params.append('date_from', filters.date_from);
  if (filters.date_to) params.append('date_to', filters.date_to);
  const str = params.toString();
  return str ? `?${str}` : '';
}

export async function fetchDashboardSummary(filters?: DashboardFilters): Promise<SummaryKPIs> {
  const res = await fetch(`${API_BASE_URL}/dashboard/summary${buildQuery(filters)}`);
  if (!res.ok) throw new Error('Failed to fetch dashboard summary');
  return res.json();
}

export async function fetchDashboardRoomUse(
  filters?: DashboardFilters,
  underusedThreshold = 30,
  overloadedThreshold = 85
): Promise<RoomUseResponse> {
  const query = new URLSearchParams();
  if (filters?.department) query.append('department', filters.department);
  if (filters?.subject) query.append('subject', filters.subject);
  if (filters?.staff) query.append('staff', filters.staff);
  query.append('underused_threshold', String(underusedThreshold));
  query.append('overloaded_threshold', String(overloadedThreshold));

  const res = await fetch(`${API_BASE_URL}/dashboard/room-use?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch room use metrics');
  return res.json();
}

export async function fetchDashboardClashes(): Promise<ClashesAnalysis> {
  const res = await fetch(`${API_BASE_URL}/dashboard/clashes`);
  if (!res.ok) throw new Error('Failed to run clash verification');
  return res.json();
}

export async function fetchDashboardHours(filters?: DashboardFilters): Promise<HoursAnalysisResponse> {
  const res = await fetch(`${API_BASE_URL}/dashboard/hours${buildQuery(filters)}`);
  if (!res.ok) throw new Error('Failed to fetch hours analysis');
  return res.json();
}

export async function fetchDashboardWorkload(filters?: DashboardFilters): Promise<WorkloadAnalysisResponse> {
  const res = await fetch(`${API_BASE_URL}/dashboard/workload${buildQuery(filters)}`);
  if (!res.ok) throw new Error('Failed to fetch staff workload metrics');
  return res.json();
}

export async function fetchDashboardChanges(): Promise<ManagementChangesSummary> {
  const res = await fetch(`${API_BASE_URL}/dashboard/changes`);
  if (!res.ok) throw new Error('Failed to fetch management changes metrics');
  return res.json();
}

export async function fetchExportStatus(): Promise<{
  excel_ready: boolean;
  pdf_ready: boolean;
  chromium_path: string | null;
  message: string;
}> {
  const res = await fetch(`${API_BASE_URL}/export/status`);
  if (!res.ok) throw new Error('Failed to fetch export status');
  return res.json();
}

export function getExcelExportUrl(): string {
  return `${API_BASE_URL}/export/excel`;
}

export function getPdfExportUrl(options?: {
  scope?: string;
  scope_value?: string;
  month?: string;
}): string {
  const params = new URLSearchParams();
  if (options?.scope) params.append('scope', options.scope);
  if (options?.scope_value) params.append('scope_value', options.scope_value);
  if (options?.month) params.append('month', options.month);
  const q = params.toString();
  return `${API_BASE_URL}/export/pdf${q ? `?${q}` : ''}`;
}




