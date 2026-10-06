import { db } from '../db.js';
import { getStoredRules } from '../services/rulesService.js';
import { createEtlRun, updateEtlRun, saveEtlIssues, } from '../db/repositories/etlRepository.js';
import { registry } from './registry.js';
import { registerRulesRules } from './rules/rulesRules.js';
import { registerSubjectsRules } from './rules/subjectsRules.js';
import { registerRoomsRules } from './rules/roomsRules.js';
import { registerStaffRules } from './rules/staffRules.js';
import { registerHolidaysRules } from './rules/holidaysRules.js';
import { registerStudentsRules } from './rules/studentsRules.js';
import { registerCrossDatasetRules } from './rules/crossDatasetRules.js';
import { writeCleanData } from './transactionWriter.js';
let rulesInitialized = false;
export function initRules() {
    if (rulesInitialized)
        return;
    registerRulesRules();
    registerSubjectsRules();
    registerRoomsRules();
    registerStaffRules();
    registerHolidaysRules();
    registerStudentsRules();
    registerCrossDatasetRules();
    rulesInitialized = true;
}
// Automatically init rules
initRules();
export const REQUIRED_DATASETS = [
    'rules',
    'subjects',
    'rooms',
    'staff',
    'students_choices',
    'holidays',
];
export function checkRequiredDatasets() {
    const missing = [];
    // Check rules
    const { rules } = getStoredRules();
    if (!rules) {
        missing.push('rules');
    }
    // Check table uploads
    const uploadRows = db.prepare('SELECT dataset FROM uploads').all();
    const uploaded = new Set(uploadRows.map((r) => r.dataset));
    for (const ds of REQUIRED_DATASETS) {
        if (ds === 'rules')
            continue;
        if (!uploaded.has(ds)) {
            missing.push(ds);
        }
    }
    return {
        ready: missing.length === 0,
        missing,
    };
}
export function loadRawDatasetRows(datasetId) {
    const uploadStmt = db.prepare('SELECT id FROM uploads WHERE dataset = ?');
    const upload = uploadStmt.get(datasetId);
    if (!upload)
        return [];
    const rowsStmt = db.prepare('SELECT row_index, row_json FROM dataset_rows WHERE upload_id = ? ORDER BY row_index ASC');
    const rows = rowsStmt.all(upload.id);
    return rows.map((r) => {
        let parsed = {};
        try {
            parsed = JSON.parse(r.row_json);
        }
        catch {
            parsed = {};
        }
        return {
            row_number: r.row_index,
            raw: { ...parsed },
            data: { ...parsed },
        };
    });
}
export function executeEtlPipeline(customInput) {
    initRules();
    // 1. Check datasets
    let rulesData = customInput?.rules;
    if (!rulesData) {
        const stored = getStoredRules();
        if (!stored.rules) {
            const err = new Error('Required dataset missing: rules');
            err.code = 'DATASETS_MISSING';
            err.missing = ['rules'];
            throw err;
        }
        rulesData = stored.rules;
    }
    const uploadRows = db.prepare('SELECT dataset FROM uploads').all();
    const uploadedSet = new Set(uploadRows.map((r) => r.dataset));
    const missingList = [];
    for (const req of REQUIRED_DATASETS) {
        if (req === 'rules') {
            if (!rulesData)
                missingList.push(req);
        }
        else {
            const hasCustom = customInput && customInput[req] !== undefined;
            const hasDb = uploadedSet.has(req);
            if (!hasCustom && !hasDb) {
                missingList.push(req);
            }
        }
    }
    if (missingList.length > 0) {
        const err = new Error(`Required datasets missing: ${missingList.join(', ')}`);
        err.code = 'DATASETS_MISSING';
        err.missing = missingList;
        throw err;
    }
    // 2. Create etl_runs record
    const runId = createEtlRun();
    // 3. Build raw dataset rows
    const toRawRows = (items, dsId) => {
        if (items) {
            return items.map((item, idx) => ({
                row_number: idx + 1,
                raw: { ...item },
                data: { ...item },
            }));
        }
        return loadRawDatasetRows(dsId);
    };
    const initialRowsIn = {
        subjects: 0,
        rooms: 0,
        staff: 0,
        holidays: 0,
        students_choices: 0,
    };
    const subjectsRows = toRawRows(customInput?.subjects, 'subjects');
    const roomsRows = toRawRows(customInput?.rooms, 'rooms');
    const staffRows = toRawRows(customInput?.staff, 'staff');
    const holidaysRows = toRawRows(customInput?.holidays, 'holidays');
    const studentsChoicesRows = toRawRows(customInput?.students_choices, 'students_choices');
    initialRowsIn.subjects = subjectsRows.length;
    initialRowsIn.rooms = roomsRows.length;
    initialRowsIn.staff = staffRows.length;
    initialRowsIn.holidays = holidaysRows.length;
    initialRowsIn.students_choices = studentsChoicesRows.length;
    const issues = [];
    const addIssue = (issue) => {
        issues.push(issue);
    };
    const ctx = {
        rules: rulesData,
        datasets: {
            subjects: subjectsRows,
            rooms: roomsRows,
            staff: staffRows,
            holidays: holidaysRows,
            students_choices: studentsChoicesRows,
        },
        issues,
        addIssue,
        cleaned: {
            subjects: [],
            rooms: [],
            staff: [],
            staff_subjects: [],
            holidays: [],
            students: [],
            student_choices: [],
        },
    };
    // 4. Run rules in deterministic pipeline order
    // a) Rules rules
    for (const rule of registry.getByDataset('rules')) {
        rule.run(ctx);
    }
    // b) Subjects rules
    for (const rule of registry.getByDataset('subjects')) {
        // Only dataset-local rules (cross-dataset ones like SUB-012, SUB-013, SUB-014 run later)
        if (!['SUB-012', 'SUB-013', 'SUB-014'].includes(rule.code)) {
            rule.run(ctx);
        }
    }
    // c) Rooms rules
    for (const rule of registry.getByDataset('rooms')) {
        if (rule.code !== 'ROM-009') {
            rule.run(ctx);
        }
    }
    // d) Staff rules
    for (const rule of registry.getByDataset('staff')) {
        if (!['STF-010', 'STF-011'].includes(rule.code)) {
            rule.run(ctx);
        }
    }
    // e) Holidays rules
    for (const rule of registry.getByDataset('holidays')) {
        rule.run(ctx);
    }
    // f) Students rules
    for (const rule of registry.getByDataset('students_choices')) {
        rule.run(ctx);
    }
    // g) Cross-dataset rules
    for (const code of ['SUB-012', 'SUB-013', 'SUB-014', 'ROM-009', 'STF-010', 'STF-011']) {
        const rule = registry.get(code);
        if (rule) {
            rule.run(ctx);
        }
    }
    // 5. Evaluate run outcome
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const status = errorCount === 0 ? 'passed' : 'failed';
    // 6. If passed, replace clean tables in single transaction
    if (status === 'passed') {
        writeCleanData(ctx);
    }
    // 7. Save issues to database
    saveEtlIssues(runId, issues);
    // 8. Compute detailed summary
    const rowsOut = {
        subjects: ctx.datasets.subjects.length,
        rooms: ctx.datasets.rooms.length,
        staff: ctx.datasets.staff.length,
        holidays: ctx.datasets.holidays.length,
        students_choices: ctx.datasets.students_choices.filter((r) => !r.quarantined).length,
    };
    const totalRowsIn = Object.values(initialRowsIn).reduce((a, b) => a + b, 0);
    const totalRowsOut = Object.values(rowsOut).reduce((a, b) => a + b, 0);
    const duplicatesRemoved = issues.filter((i) => i.action_taken === 'removed' && (i.rule_code === 'SUB-003' || i.rule_code === 'ROM-003' || i.rule_code === 'STF-003' || i.rule_code === 'HOL-006' || i.rule_code === 'STU-003' || i.rule_code === 'STU-004')).length;
    const autoFixes = issues.filter((i) => i.action_taken === 'fixed' || i.action_taken === 'filled' || i.action_taken === 'dropped').length;
    const byRule = {};
    for (const issue of issues) {
        byRule[issue.rule_code] = (byRule[issue.rule_code] || 0) + 1;
    }
    const byDataset = {};
    for (const ds of ['rules', 'subjects', 'rooms', 'staff', 'holidays', 'students_choices']) {
        const dsIssues = issues.filter((i) => i.dataset === ds);
        byDataset[ds] = {
            rowsIn: initialRowsIn[ds] ?? (ds === 'rules' ? 1 : 0),
            rowsOut: rowsOut[ds] ?? (ds === 'rules' ? 1 : 0),
            errors: dsIssues.filter((i) => i.severity === 'error').length,
            warnings: dsIssues.filter((i) => i.severity === 'warning').length,
        };
    }
    const summary = {
        rowsIn: totalRowsIn,
        rowsOut: totalRowsOut,
        duplicatesRemoved,
        autoFixes,
        warnings: warningCount,
        errors: errorCount,
        byRule,
        byDataset,
    };
    // 9. Update etl_runs record
    updateEtlRun(runId, status, initialRowsIn, rowsOut, errorCount, warningCount);
    return {
        runId,
        status,
        summary,
    };
}
