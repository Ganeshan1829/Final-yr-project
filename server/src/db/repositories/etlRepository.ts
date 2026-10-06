import { db } from '../../db.js';
import type { EtlRunSummary } from '../../etl/types.js';

export interface EtlRunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'passed' | 'failed';
  stale: number;
  rows_in_json: string | null;
  rows_out_json: string | null;
  error_count: number;
  warning_count: number;
}

export interface EtlIssueRecord {
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

export interface EtlIssueInput {
  rule_code: string;
  dataset: string;
  row_number: number;
  column: string | null;
  severity: 'error' | 'warning';
  action_taken: string | null;
  original_value: string | null;
  new_value: string | null;
  message: string;
}

export interface CleanSummary {
  lastPassedRunId: number | null;
  lastPassedAt: string | null;
  counts: {
    subjects: number;
    rooms: number;
    staff: number;
    staff_subjects: number;
    students: number;
    student_choices: number;
    holidays_clean: number;
    sections: number;
    timetable_slots: number;
    calendar_sessions: number;
  };
}

export function createEtlRun(): number {
  const stmt = db.prepare(`
    INSERT INTO etl_runs (started_at, status, stale, error_count, warning_count)
    VALUES (?, 'running', 0, 0, 0)
  `);
  const now = new Date().toISOString();
  const info = stmt.run(now);
  return Number(info.lastInsertRowid);
}

export function updateEtlRun(
  runId: number,
  status: 'passed' | 'failed',
  rowsIn: Record<string, number>,
  rowsOut: Record<string, number>,
  errorCount: number,
  warningCount: number
): void {
  const stmt = db.prepare(`
    UPDATE etl_runs
    SET finished_at = ?,
        status = ?,
        rows_in_json = ?,
        rows_out_json = ?,
        error_count = ?,
        warning_count = ?
    WHERE id = ?
  `);
  stmt.run(
    new Date().toISOString(),
    status,
    JSON.stringify(rowsIn),
    JSON.stringify(rowsOut),
    errorCount,
    warningCount,
    runId
  );
}

export function getEtlRuns(): EtlRunRecord[] {
  const stmt = db.prepare('SELECT * FROM etl_runs ORDER BY id DESC');
  return stmt.all() as unknown as EtlRunRecord[];
}

export function getEtlRunById(id: number): EtlRunRecord | null {
  const stmt = db.prepare('SELECT * FROM etl_runs WHERE id = ?');
  const row = stmt.get(id);
  return (row as unknown as EtlRunRecord) || null;
}

export function getLatestEtlRun(): (EtlRunRecord & { isStale: boolean }) | null {
  const stmt = db.prepare('SELECT * FROM etl_runs ORDER BY id DESC LIMIT 1');
  const run = stmt.get() as unknown as EtlRunRecord | undefined;
  if (!run) return null;

  let isStale = run.stale === 1;
  if (!isStale && run.started_at) {
    const latestUpload = db.prepare('SELECT MAX(uploaded_at) as max_up FROM uploads').get() as { max_up: string | null };
    if (latestUpload?.max_up && latestUpload.max_up > run.started_at) {
      isStale = true;
    }
    const latestRules = db.prepare('SELECT updated_at FROM rules WHERE id = 1').get() as { updated_at: string | null } | undefined;
    if (latestRules?.updated_at && latestRules.updated_at > run.started_at) {
      isStale = true;
    }
    if (isStale) {
      db.prepare('UPDATE etl_runs SET stale = 1 WHERE id = ?').run(run.id);
    }
  }

  return {
    ...run,
    stale: isStale ? 1 : 0,
    isStale,
  };
}

export function markRunsStale(): void {
  db.prepare('UPDATE etl_runs SET stale = 1 WHERE stale = 0').run();
  try {
    db.prepare('UPDATE engine_state SET stale = 1 WHERE id = 1').run();
  } catch {
    // ignore if table not initialized
  }
}

export function saveEtlIssues(runId: number, issues: EtlIssueInput[]): void {
  if (issues.length === 0) return;
  const stmt = db.prepare(`
    INSERT INTO etl_issues (
      run_id, rule_code, dataset, row_number, column_name,
      severity, action_taken, original_value, new_value, message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const issue of issues) {
      stmt.run(
        runId,
        issue.rule_code,
        issue.dataset,
        issue.row_number,
        issue.column || null,
        issue.severity,
        issue.action_taken || null,
        issue.original_value !== null && issue.original_value !== undefined ? String(issue.original_value) : null,
        issue.new_value !== null && issue.new_value !== undefined ? String(issue.new_value) : null,
        issue.message
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export interface IssueFilterParams {
  severity?: string;
  dataset?: string;
  rule?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function getEtlIssues(
  runId: number,
  params: IssueFilterParams = {}
): { issues: EtlIssueRecord[]; total: number } {
  let whereClauses = ['run_id = ?'];
  const args: any[] = [runId];

  if (params.severity) {
    whereClauses.push('severity = ?');
    args.push(params.severity);
  }

  if (params.dataset) {
    whereClauses.push('dataset = ?');
    args.push(params.dataset);
  }

  if (params.rule) {
    whereClauses.push('rule_code = ?');
    args.push(params.rule);
  }

  if (params.q) {
    whereClauses.push('(message LIKE ? OR column_name LIKE ? OR original_value LIKE ? OR new_value LIKE ?)');
    const qStr = `%${params.q}%`;
    args.push(qStr, qStr, qStr, qStr);
  }

  const whereSql = whereClauses.join(' AND ');

  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM etl_issues WHERE ${whereSql}`);
  const countRow = countStmt.get(...args) as { count: number };
  const total = countRow.count;

  const page = Math.max(1, params.page || 1);
  const pageSize = Math.max(1, Math.min(500, params.pageSize || 50));
  const offset = (page - 1) * pageSize;

  const dataStmt = db.prepare(`
    SELECT * FROM etl_issues 
    WHERE ${whereSql}
    ORDER BY CASE WHEN severity = 'error' THEN 0 ELSE 1 END, id ASC
    LIMIT ? OFFSET ?
  `);

  const issues = dataStmt.all(...args, pageSize, offset) as unknown as EtlIssueRecord[];

  return { issues, total };
}

export function getAllIssuesForRun(runId: number): EtlIssueRecord[] {
  const stmt = db.prepare(`
    SELECT * FROM etl_issues 
    WHERE run_id = ?
    ORDER BY CASE WHEN severity = 'error' THEN 0 ELSE 1 END, id ASC
  `);
  return stmt.all(runId) as unknown as EtlIssueRecord[];
}

export function getCleanSummary(): CleanSummary {
  const lastPassedStmt = db.prepare(
    "SELECT id, finished_at FROM etl_runs WHERE status = 'passed' ORDER BY id DESC LIMIT 1"
  );
  const lastPassed = lastPassedStmt.get() as { id: number; finished_at: string } | undefined;

  const getCount = (table: string) => {
    try {
      const res = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      return res.count;
    } catch {
      return 0;
    }
  };

  return {
    lastPassedRunId: lastPassed?.id || null,
    lastPassedAt: lastPassed?.finished_at || null,
    counts: {
      subjects: getCount('subjects'),
      rooms: getCount('rooms'),
      staff: getCount('staff'),
      staff_subjects: getCount('staff_subjects'),
      students: getCount('students'),
      student_choices: getCount('student_choices'),
      holidays_clean: getCount('holidays_clean'),
      sections: getCount('sections'),
      timetable_slots: getCount('timetable_slots'),
      calendar_sessions: getCount('calendar_sessions'),
    },
  };
}

export function getRunSummary(runId: number): EtlRunSummary | null {
  const run = getEtlRunById(runId);
  if (!run) return null;

  const rowsIn: Record<string, number> = run.rows_in_json ? JSON.parse(run.rows_in_json) : {};
  const rowsOut: Record<string, number> = run.rows_out_json ? JSON.parse(run.rows_out_json) : {};

  let totalRowsIn = 0;
  for (const v of Object.values(rowsIn)) {
    totalRowsIn += v;
  }
  let totalRowsOut = 0;
  for (const v of Object.values(rowsOut)) {
    totalRowsOut += v;
  }

  const issues = getAllIssuesForRun(runId);
  let duplicatesRemoved = 0;
  let autoFixes = 0;
  let warnings = 0;
  let errors = 0;
  const byRule: Record<string, number> = {};
  const byDataset: Record<string, { rowsIn: number; rowsOut: number; errors: number; warnings: number }> = {};

  ['rules', 'subjects', 'rooms', 'staff', 'holidays', 'students_choices'].forEach((ds) => {
    byDataset[ds] = {
      rowsIn: rowsIn[ds] || 0,
      rowsOut: rowsOut[ds] || 0,
      errors: 0,
      warnings: 0,
    };
  });

  for (const issue of issues) {
    if (issue.severity === 'error') {
      errors++;
    } else {
      warnings++;
    }

    if (issue.action_taken === 'removed') {
      duplicatesRemoved++;
    }
    if (['fixed', 'filled', 'removed', 'dropped'].includes(issue.action_taken || '')) {
      autoFixes++;
    }

    byRule[issue.rule_code] = (byRule[issue.rule_code] || 0) + 1;

    if (!byDataset[issue.dataset]) {
      byDataset[issue.dataset] = {
        rowsIn: rowsIn[issue.dataset] || 0,
        rowsOut: rowsOut[issue.dataset] || 0,
        errors: 0,
        warnings: 0,
      };
    }

    if (issue.severity === 'error') {
      byDataset[issue.dataset].errors++;
    } else {
      byDataset[issue.dataset].warnings++;
    }
  }

  return {
    rowsIn: totalRowsIn,
    rowsOut: totalRowsOut,
    duplicatesRemoved,
    autoFixes,
    warnings,
    errors,
    byRule,
    byDataset,
  };
}

