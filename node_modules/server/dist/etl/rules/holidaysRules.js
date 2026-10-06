import { registerRule } from '../registry.js';
export function registerHolidaysRules() {
    // HOL-001: Trim
    registerRule({
        code: 'HOL-001',
        dataset: 'holidays',
        severity: 'warning',
        description: 'Trim leading/trailing spaces in holidays cells',
        run: (ctx) => {
            const rows = ctx.datasets.holidays;
            for (const row of rows) {
                for (const [col, val] of Object.entries(row.data)) {
                    if (typeof val === 'string') {
                        const trimmed = val.trim();
                        if (trimmed !== val) {
                            row.data[col] = trimmed;
                            ctx.addIssue({
                                rule_code: 'HOL-001',
                                dataset: 'holidays',
                                row_number: row.row_number,
                                column: col,
                                severity: 'warning',
                                action_taken: 'fixed',
                                original_value: val,
                                new_value: trimmed,
                                message: `Trimmed whitespace from ${col}`,
                            });
                        }
                    }
                }
            }
        },
    });
    // HOL-006: Exact duplicate removed
    registerRule({
        code: 'HOL-006',
        dataset: 'holidays',
        severity: 'warning',
        description: 'Exact duplicate holiday row removed, keeping the first',
        run: (ctx) => {
            const rows = ctx.datasets.holidays;
            const seen = new Set();
            const surviving = [];
            for (const row of rows) {
                const key = JSON.stringify(row.data);
                if (seen.has(key)) {
                    ctx.addIssue({
                        rule_code: 'HOL-006',
                        dataset: 'holidays',
                        row_number: row.row_number,
                        column: null,
                        severity: 'warning',
                        action_taken: 'removed',
                        original_value: key,
                        new_value: null,
                        message: `Exact duplicate holiday row removed (row ${row.row_number})`,
                    });
                }
                else {
                    seen.add(key);
                    surviving.push(row);
                }
            }
            ctx.datasets.holidays = surviving;
        },
    });
    // HOL-002: date not a valid YYYY-MM-DD
    registerRule({
        code: 'HOL-002',
        dataset: 'holidays',
        severity: 'error',
        description: 'date not a valid YYYY-MM-DD',
        run: (ctx) => {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            const rows = ctx.datasets.holidays;
            for (const row of rows) {
                for (const col of ['date_from', 'date_to']) {
                    const val = String(row.data[col] || '').trim();
                    let isValid = dateRegex.test(val);
                    if (isValid) {
                        const d = new Date(val + 'T00:00:00Z');
                        if (isNaN(d.getTime()))
                            isValid = false;
                    }
                    if (!isValid) {
                        ctx.addIssue({
                            rule_code: 'HOL-002',
                            dataset: 'holidays',
                            row_number: row.row_number,
                            column: col,
                            severity: 'error',
                            action_taken: null,
                            original_value: String(row.data[col] ?? ''),
                            new_value: null,
                            message: `Invalid date format for ${col}: '${val}', expected YYYY-MM-DD`,
                        });
                    }
                }
            }
        },
    });
    // HOL-003: date_from after date_to: swapped
    registerRule({
        code: 'HOL-003',
        dataset: 'holidays',
        severity: 'warning',
        description: 'date_from after date_to: swapped',
        run: (ctx) => {
            const rows = ctx.datasets.holidays;
            for (const row of rows) {
                const from = String(row.data.date_from || '').trim();
                const to = String(row.data.date_to || '').trim();
                if (from && to && from > to) {
                    row.data.date_from = to;
                    row.data.date_to = from;
                    ctx.addIssue({
                        rule_code: 'HOL-003',
                        dataset: 'holidays',
                        row_number: row.row_number,
                        column: 'date_from',
                        severity: 'warning',
                        action_taken: 'fixed',
                        original_value: `${from} > ${to}`,
                        new_value: `${to} <= ${from}`,
                        message: `Swapped date_from (${from}) and date_to (${to}) because date_from was after date_to`,
                    });
                }
            }
        },
    });
    // HOL-004: range lies completely outside the semester
    registerRule({
        code: 'HOL-004',
        dataset: 'holidays',
        severity: 'warning',
        description: 'Holiday range lies completely outside the semester (marked ignored=1)',
        run: (ctx) => {
            const { semester_start, semester_end } = ctx.rules;
            if (!semester_start || !semester_end)
                return;
            const rows = ctx.datasets.holidays;
            for (const row of rows) {
                const from = String(row.data.date_from || '').trim();
                const to = String(row.data.date_to || '').trim();
                if (to < semester_start || from > semester_end) {
                    row.data.ignored = 1;
                    ctx.addIssue({
                        rule_code: 'HOL-004',
                        dataset: 'holidays',
                        row_number: row.row_number,
                        column: 'date_from',
                        severity: 'warning',
                        action_taken: 'fixed',
                        original_value: `${from}..${to}`,
                        new_value: 'ignored=1',
                        message: `Holiday (${from}..${to}) lies completely outside semester (${semester_start}..${semester_end}); marked as ignored`,
                    });
                }
                else {
                    row.data.ignored = 0;
                }
            }
        },
    });
    // HOL-005: type not in public_holiday, institution_holiday, internal_exam
    registerRule({
        code: 'HOL-005',
        dataset: 'holidays',
        severity: 'error',
        description: 'type not in public_holiday, institution_holiday, internal_exam',
        run: (ctx) => {
            const allowed = ['public_holiday', 'institution_holiday', 'internal_exam'];
            const rows = ctx.datasets.holidays;
            for (const row of rows) {
                const type = String(row.data.type || '').trim().toLowerCase();
                if (!allowed.includes(type)) {
                    ctx.addIssue({
                        rule_code: 'HOL-005',
                        dataset: 'holidays',
                        row_number: row.row_number,
                        column: 'type',
                        severity: 'error',
                        action_taken: null,
                        original_value: String(row.data.type ?? ''),
                        new_value: null,
                        message: `Invalid holiday type '${row.data.type}', must be one of: ${allowed.join(', ')}`,
                    });
                }
            }
        },
    });
}
