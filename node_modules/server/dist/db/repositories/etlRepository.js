import { db } from '../../db.js';
export function createEtlRun() {
    const stmt = db.prepare(`
    INSERT INTO etl_runs (started_at, status, stale, error_count, warning_count)
    VALUES (?, 'running', 0, 0, 0)
  `);
    const now = new Date().toISOString();
    const info = stmt.run(now);
    return Number(info.lastInsertRowid);
}
export function updateEtlRun(runId, status, rowsIn, rowsOut, errorCount, warningCount) {
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
    stmt.run(new Date().toISOString(), status, JSON.stringify(rowsIn), JSON.stringify(rowsOut), errorCount, warningCount, runId);
}
export function getEtlRuns() {
    const stmt = db.prepare('SELECT * FROM etl_runs ORDER BY id DESC');
    return stmt.all();
}
export function getEtlRunById(id) {
    const stmt = db.prepare('SELECT * FROM etl_runs WHERE id = ?');
    const row = stmt.get(id);
    return row || null;
}
export function getLatestEtlRun() {
    const stmt = db.prepare('SELECT * FROM etl_runs ORDER BY id DESC LIMIT 1');
    const run = stmt.get();
    if (!run)
        return null;
    let isStale = run.stale === 1;
    if (!isStale && run.started_at) {
        const latestUpload = db.prepare('SELECT MAX(uploaded_at) as max_up FROM uploads').get();
        if (latestUpload?.max_up && latestUpload.max_up > run.started_at) {
            isStale = true;
        }
        const latestRules = db.prepare('SELECT updated_at FROM rules WHERE id = 1').get();
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
export function markRunsStale() {
    db.prepare('UPDATE etl_runs SET stale = 1 WHERE stale = 0').run();
    try {
        db.prepare('UPDATE engine_state SET stale = 1 WHERE id = 1').run();
    }
    catch {
        // ignore if table not initialized
    }
}
export function saveEtlIssues(runId, issues) {
    if (issues.length === 0)
        return;
    const stmt = db.prepare(`
    INSERT INTO etl_issues (
      run_id, rule_code, dataset, row_number, column_name,
      severity, action_taken, original_value, new_value, message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    db.exec('BEGIN TRANSACTION;');
    try {
        for (const issue of issues) {
            stmt.run(runId, issue.rule_code, issue.dataset, issue.row_number, issue.column || null, issue.severity, issue.action_taken || null, issue.original_value !== null && issue.original_value !== undefined ? String(issue.original_value) : null, issue.new_value !== null && issue.new_value !== undefined ? String(issue.new_value) : null, issue.message);
        }
        db.exec('COMMIT;');
    }
    catch (err) {
        db.exec('ROLLBACK;');
        throw err;
    }
}
export function getEtlIssues(runId, params = {}) {
    let whereClauses = ['run_id = ?'];
    const args = [runId];
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
    const countRow = countStmt.get(...args);
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
    const issues = dataStmt.all(...args, pageSize, offset);
    return { issues, total };
}
export function getAllIssuesForRun(runId) {
    const stmt = db.prepare(`
    SELECT * FROM etl_issues 
    WHERE run_id = ?
    ORDER BY CASE WHEN severity = 'error' THEN 0 ELSE 1 END, id ASC
  `);
    return stmt.all(runId);
}
export function getCleanSummary() {
    const lastPassedStmt = db.prepare("SELECT id, finished_at FROM etl_runs WHERE status = 'passed' ORDER BY id DESC LIMIT 1");
    const lastPassed = lastPassedStmt.get();
    const getCount = (table) => {
        try {
            const res = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
            return res.count;
        }
        catch {
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
export function getRunSummary(runId) {
    const run = getEtlRunById(runId);
    if (!run)
        return null;
    const rowsIn = run.rows_in_json ? JSON.parse(run.rows_in_json) : {};
    const rowsOut = run.rows_out_json ? JSON.parse(run.rows_out_json) : {};
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
    const byRule = {};
    const byDataset = {};
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
        }
        else {
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
        }
        else {
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
