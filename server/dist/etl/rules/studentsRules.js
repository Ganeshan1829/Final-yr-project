import { registerRule } from '../registry.js';
export function registerStudentsRules() {
    // 1. STU-001: Trim
    registerRule({
        code: 'STU-001',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Trim leading/trailing whitespace in students_choices cells',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            for (const row of rows) {
                for (const [col, val] of Object.entries(row.data)) {
                    if (typeof val === 'string') {
                        const trimmed = val.trim();
                        if (trimmed !== val) {
                            row.data[col] = trimmed;
                            ctx.addIssue({
                                rule_code: 'STU-001',
                                dataset: 'students_choices',
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
    // 2. STU-002: Case normalization
    registerRule({
        code: 'STU-002',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Normalize case: student_id, subject_code, staff_id, department UPPER',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            const colsToUpper = ['student_id', 'subject_code', 'staff_id'];
            for (const row of rows) {
                for (const col of colsToUpper) {
                    const val = row.data[col];
                    if (typeof val === 'string' && val.length > 0) {
                        const upper = val.toUpperCase();
                        if (upper !== val) {
                            row.data[col] = upper;
                            ctx.addIssue({
                                rule_code: 'STU-002',
                                dataset: 'students_choices',
                                row_number: row.row_number,
                                column: col,
                                severity: 'warning',
                                action_taken: 'fixed',
                                original_value: val,
                                new_value: upper,
                                message: `Normalized ${col} to uppercase`,
                            });
                        }
                    }
                }
                const dept = row.data.department;
                if (typeof dept === 'string' && dept.length > 0 && dept === dept.toLowerCase()) {
                    const upper = dept.toUpperCase();
                    row.data.department = upper;
                    ctx.addIssue({
                        rule_code: 'STU-002',
                        dataset: 'students_choices',
                        row_number: row.row_number,
                        column: 'department',
                        severity: 'warning',
                        action_taken: 'fixed',
                        original_value: dept,
                        new_value: upper,
                        message: `Normalized department to uppercase`,
                    });
                }
            }
        },
    });
    // 3. STU-006: Blank student_id, subject_code or staff_id (cannot be filled, row quarantined)
    registerRule({
        code: 'STU-006',
        dataset: 'students_choices',
        severity: 'error',
        description: 'Blank student_id, subject_code or staff_id: cannot be filled (error, row quarantined)',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            for (const row of rows) {
                for (const col of ['student_id', 'subject_code', 'staff_id']) {
                    const val = row.data[col];
                    if (val === undefined || val === null || String(val).trim() === '') {
                        row.quarantined = true;
                        row.quarantineReason = 'STU-006';
                        ctx.addIssue({
                            rule_code: 'STU-006',
                            dataset: 'students_choices',
                            row_number: row.row_number,
                            column: col,
                            severity: 'error',
                            action_taken: null,
                            original_value: null,
                            new_value: null,
                            message: `Required field ${col} is missing/blank (row quarantined)`,
                        });
                    }
                }
            }
        },
    });
    // 4. STU-014: year, semester or selection_order present but not a whole number (error, row quarantined)
    registerRule({
        code: 'STU-014',
        dataset: 'students_choices',
        severity: 'error',
        description: 'year, semester or selection_order present but not a whole number (error, row quarantined)',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            const numCols = ['year', 'semester', 'selection_order'];
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                for (const col of numCols) {
                    const val = row.data[col];
                    if (val !== undefined && val !== null && String(val).trim() !== '') {
                        const num = Number(val);
                        if (!Number.isInteger(num)) {
                            row.quarantined = true;
                            row.quarantineReason = 'STU-014';
                            ctx.addIssue({
                                rule_code: 'STU-014',
                                dataset: 'students_choices',
                                row_number: row.row_number,
                                column: col,
                                severity: 'error',
                                action_taken: null,
                                original_value: String(val),
                                new_value: null,
                                message: `Field ${col} must be a whole number, received: '${val}' (row quarantined)`,
                            });
                        }
                    }
                }
            }
        },
    });
    // 5. STU-003: Exact duplicate: same student_id, subject_code and staff_id. Keep first, remove later ones
    registerRule({
        code: 'STU-003',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Exact duplicate: same student_id, subject_code and staff_id (keep first, remove others)',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            const seen = new Set();
            const surviving = [];
            for (const row of rows) {
                if (row.quarantined) {
                    surviving.push(row);
                    continue;
                }
                const key = `${row.data.student_id}::${row.data.subject_code}::${row.data.staff_id}`;
                if (seen.has(key)) {
                    row.quarantined = true;
                    row.quarantineReason = 'STU-003';
                    ctx.addIssue({
                        rule_code: 'STU-003',
                        dataset: 'students_choices',
                        row_number: row.row_number,
                        column: `${row.data.subject_code}/${row.data.staff_id}`,
                        severity: 'warning',
                        action_taken: 'removed',
                        original_value: key,
                        new_value: null,
                        message: `Removed exact duplicate student choice for student ${row.data.student_id}, subject ${row.data.subject_code}, staff ${row.data.staff_id}`,
                    });
                }
                else {
                    seen.add(key);
                    surviving.push(row);
                }
            }
            ctx.datasets.students_choices = surviving;
        },
    });
    // 6. STU-004: Conflicting choice: same student_id and subject_code with different staff_id.
    // Keep earliest selected_at (tie: lowest row number), remove others
    registerRule({
        code: 'STU-004',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Conflicting choice: same student_id and subject_code with different staff_id (keep earliest selected_at)',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            const choicesMap = new Map();
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                const key = `${row.data.student_id}::${row.data.subject_code}`;
                if (!choicesMap.has(key)) {
                    choicesMap.set(key, []);
                }
                choicesMap.get(key).push(row);
            }
            for (const [key, group] of choicesMap.entries()) {
                if (group.length > 1) {
                    // Sort by selected_at ascending, tie breaker: row_number ascending
                    group.sort((a, b) => {
                        const timeA = a.data.selected_at ? new Date(a.data.selected_at).getTime() : Infinity;
                        const timeB = b.data.selected_at ? new Date(b.data.selected_at).getTime() : Infinity;
                        if (timeA !== timeB)
                            return timeA - timeB;
                        return a.row_number - b.row_number;
                    });
                    const kept = group[0];
                    for (let i = 1; i < group.length; i++) {
                        const dropped = group[i];
                        dropped.quarantined = true;
                        dropped.quarantineReason = 'STU-004';
                        ctx.addIssue({
                            rule_code: 'STU-004',
                            dataset: 'students_choices',
                            row_number: dropped.row_number,
                            column: `${dropped.data.subject_code}/${dropped.data.staff_id}`,
                            severity: 'warning',
                            action_taken: 'removed',
                            original_value: dropped.data.staff_id,
                            new_value: kept.data.staff_id,
                            message: `Conflicting choice for student ${dropped.data.student_id} and subject ${dropped.data.subject_code}: kept staff ${kept.data.staff_id}, dropped staff ${dropped.data.staff_id}`,
                        });
                    }
                }
            }
        },
    });
    // 7. STU-005 & STU-015: Blank student_name, department, semester fills and check
    registerRule({
        code: 'STU-005',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Blank student_name, department or semester filled from mode across student choices; dept fallback to rules.department',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            // Group non-quarantined rows by student_id to find mode for name, dept, semester
            const studentStats = new Map();
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                const sId = row.data.student_id;
                if (!sId)
                    continue;
                if (!studentStats.has(sId)) {
                    studentStats.set(sId, { names: [], departments: [], semesters: [] });
                }
                const stat = studentStats.get(sId);
                if (row.data.student_name && String(row.data.student_name).trim()) {
                    stat.names.push(String(row.data.student_name).trim());
                }
                if (row.data.department && String(row.data.department).trim()) {
                    stat.departments.push(String(row.data.department).trim());
                }
                if (row.data.semester !== undefined && row.data.semester !== null && String(row.data.semester).trim()) {
                    stat.semesters.push(String(row.data.semester).trim());
                }
            }
            const getMode = (arr) => {
                if (arr.length === 0)
                    return null;
                const counts = new Map();
                let maxVal = arr[0];
                let maxCount = 0;
                for (const item of arr) {
                    const c = (counts.get(item) || 0) + 1;
                    counts.set(item, c);
                    if (c > maxCount) {
                        maxCount = c;
                        maxVal = item;
                    }
                }
                return maxVal;
            };
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                const sId = row.data.student_id;
                const stat = sId ? studentStats.get(sId) : null;
                // student_name
                if (!row.data.student_name || String(row.data.student_name).trim() === '') {
                    const modeName = stat ? getMode(stat.names) : null;
                    if (modeName) {
                        row.data.student_name = modeName;
                        ctx.addIssue({
                            rule_code: 'STU-005',
                            dataset: 'students_choices',
                            row_number: row.row_number,
                            column: 'student_name',
                            severity: 'warning',
                            action_taken: 'filled',
                            original_value: null,
                            new_value: modeName,
                            message: `Filled blank student_name with most common name '${modeName}' for student ${sId}`,
                        });
                    }
                }
                // department
                if (!row.data.department || String(row.data.department).trim() === '') {
                    let filledDept = stat ? getMode(stat.departments) : null;
                    if (!filledDept && ctx.rules.department) {
                        filledDept = ctx.rules.department;
                    }
                    if (filledDept) {
                        row.data.department = filledDept;
                        ctx.addIssue({
                            rule_code: 'STU-005',
                            dataset: 'students_choices',
                            row_number: row.row_number,
                            column: 'department',
                            severity: 'warning',
                            action_taken: 'filled',
                            original_value: null,
                            new_value: filledDept,
                            message: `Filled blank department with '${filledDept}' for student ${sId}`,
                        });
                    }
                }
                // semester
                if (row.data.semester === undefined || row.data.semester === null || String(row.data.semester).trim() === '') {
                    const modeSem = stat ? getMode(stat.semesters) : null;
                    if (modeSem) {
                        row.data.semester = Number(modeSem);
                        ctx.addIssue({
                            rule_code: 'STU-005',
                            dataset: 'students_choices',
                            row_number: row.row_number,
                            column: 'semester',
                            severity: 'warning',
                            action_taken: 'filled',
                            original_value: null,
                            new_value: modeSem,
                            message: `Filled blank semester with most common semester '${modeSem}' for student ${sId}`,
                        });
                    }
                }
            }
        },
    });
    registerRule({
        code: 'STU-015',
        dataset: 'students_choices',
        severity: 'error',
        description: 'student_name, department or semester still blank after STU-005',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices;
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                for (const col of ['student_name', 'department', 'semester']) {
                    const val = row.data[col];
                    if (val === undefined || val === null || String(val).trim() === '') {
                        ctx.addIssue({
                            rule_code: 'STU-015',
                            dataset: 'students_choices',
                            row_number: row.row_number,
                            column: col,
                            severity: 'error',
                            action_taken: null,
                            original_value: null,
                            new_value: null,
                            message: `Field ${col} is still blank after auto-fill for student ${row.data.student_id}`,
                        });
                    }
                }
            }
        },
    });
    // 8. STU-007: subject_code not in subjects (error, quarantined)
    registerRule({
        code: 'STU-007',
        dataset: 'students_choices',
        severity: 'error',
        description: 'subject_code not in subjects (error, quarantined)',
        run: (ctx) => {
            const validSubjects = new Set(ctx.datasets.subjects.map((r) => String(r.data.subject_code || '').toUpperCase()));
            const rows = ctx.datasets.students_choices;
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                const code = String(row.data.subject_code || '').toUpperCase();
                if (!validSubjects.has(code)) {
                    row.quarantined = true;
                    row.quarantineReason = 'STU-007';
                    ctx.addIssue({
                        rule_code: 'STU-007',
                        dataset: 'students_choices',
                        row_number: row.row_number,
                        column: 'subject_code',
                        severity: 'error',
                        action_taken: null,
                        original_value: row.data.subject_code,
                        new_value: null,
                        message: `Subject code '${row.data.subject_code}' does not exist in subjects dataset (row quarantined)`,
                    });
                }
            }
        },
    });
    // 9. STU-008: staff_id not in staff (error, quarantined)
    registerRule({
        code: 'STU-008',
        dataset: 'students_choices',
        severity: 'error',
        description: 'staff_id not in staff (error, quarantined)',
        run: (ctx) => {
            const validStaff = new Set(ctx.datasets.staff.map((r) => String(r.data.staff_id || '').toUpperCase()));
            const rows = ctx.datasets.students_choices;
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                const staffId = String(row.data.staff_id || '').toUpperCase();
                if (!validStaff.has(staffId)) {
                    row.quarantined = true;
                    row.quarantineReason = 'STU-008';
                    ctx.addIssue({
                        rule_code: 'STU-008',
                        dataset: 'students_choices',
                        row_number: row.row_number,
                        column: 'staff_id',
                        severity: 'error',
                        action_taken: null,
                        original_value: row.data.staff_id,
                        new_value: null,
                        message: `Staff ID '${row.data.staff_id}' does not exist in staff dataset (row quarantined)`,
                    });
                }
            }
        },
    });
    // 10. STU-009: staff cannot teach that subject per subjects_can_teach (error, quarantined)
    registerRule({
        code: 'STU-009',
        dataset: 'students_choices',
        severity: 'error',
        description: 'staff cannot teach that subject per subjects_can_teach (error, quarantined)',
        run: (ctx) => {
            const staffCanTeachMap = new Map();
            for (const s of ctx.datasets.staff) {
                const id = String(s.data.staff_id || '').toUpperCase();
                const canTeach = String(s.data.subjects_can_teach || '')
                    .split(';')
                    .map((c) => c.trim().toUpperCase())
                    .filter(Boolean);
                staffCanTeachMap.set(id, new Set(canTeach));
            }
            const rows = ctx.datasets.students_choices;
            for (const row of rows) {
                if (row.quarantined)
                    continue;
                const staffId = String(row.data.staff_id || '').toUpperCase();
                const subjectCode = String(row.data.subject_code || '').toUpperCase();
                const canTeach = staffCanTeachMap.get(staffId);
                if (canTeach && !canTeach.has(subjectCode)) {
                    row.quarantined = true;
                    row.quarantineReason = 'STU-009';
                    ctx.addIssue({
                        rule_code: 'STU-009',
                        dataset: 'students_choices',
                        row_number: row.row_number,
                        column: 'staff_id',
                        severity: 'error',
                        action_taken: null,
                        original_value: `${subjectCode}/${staffId}`,
                        new_value: null,
                        message: `Staff member ${staffId} is not qualified to teach subject ${subjectCode} (row quarantined)`,
                    });
                }
            }
        },
    });
    // 11. Section checks: STU-010, STU-016, STU-011
    registerRule({
        code: 'STU-010',
        dataset: 'students_choices',
        severity: 'error',
        description: 'Section size greater than max_section_size',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices.filter((r) => !r.quarantined);
            const sectionCounts = new Map();
            for (const row of rows) {
                const key = `${row.data.subject_code}::${row.data.staff_id}`;
                if (!sectionCounts.has(key)) {
                    sectionCounts.set(key, { count: 0, rows: [] });
                }
                const s = sectionCounts.get(key);
                s.count++;
                s.rows.push(row);
            }
            const max = ctx.rules.max_section_size;
            for (const [key, { count }] of sectionCounts.entries()) {
                if (count > max) {
                    const [sub, staff] = key.split('::');
                    ctx.addIssue({
                        rule_code: 'STU-010',
                        dataset: 'students_choices',
                        row_number: 0,
                        column: `${sub}/${staff}`,
                        severity: 'error',
                        action_taken: null,
                        original_value: String(count),
                        new_value: String(max),
                        message: `Section size for subject ${sub} and staff ${staff} is ${count}, exceeding max_section_size of ${max}`,
                    });
                }
            }
        },
    });
    registerRule({
        code: 'STU-016',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Section size greater than default and not above max',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices.filter((r) => !r.quarantined);
            const sectionCounts = new Map();
            for (const row of rows) {
                const key = `${row.data.subject_code}::${row.data.staff_id}`;
                sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
            }
            const def = ctx.rules.default_section_size;
            const max = ctx.rules.max_section_size;
            for (const [key, count] of sectionCounts.entries()) {
                if (count > def && count <= max) {
                    const [sub, staff] = key.split('::');
                    ctx.addIssue({
                        rule_code: 'STU-016',
                        dataset: 'students_choices',
                        row_number: 0,
                        column: `${sub}/${staff}`,
                        severity: 'warning',
                        action_taken: null,
                        original_value: String(count),
                        new_value: String(def),
                        message: `Section size for subject ${sub} and staff ${staff} is ${count}, above default section size (${def})`,
                    });
                }
            }
        },
    });
    registerRule({
        code: 'STU-011',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'Section size below min_section_size',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices.filter((r) => !r.quarantined);
            const sectionCounts = new Map();
            for (const row of rows) {
                const key = `${row.data.subject_code}::${row.data.staff_id}`;
                sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
            }
            const min = ctx.rules.min_section_size;
            for (const [key, count] of sectionCounts.entries()) {
                if (count < min) {
                    const [sub, staff] = key.split('::');
                    ctx.addIssue({
                        rule_code: 'STU-011',
                        dataset: 'students_choices',
                        row_number: 0,
                        column: `${sub}/${staff}`,
                        severity: 'warning',
                        action_taken: null,
                        original_value: String(count),
                        new_value: String(min),
                        message: `Section size for subject ${sub} and staff ${staff} is ${count}, below min_section_size of ${min}`,
                    });
                }
            }
        },
    });
    // 12. STU-012: student has fewer distinct subjects than number of theory subjects in subjects dataset
    registerRule({
        code: 'STU-012',
        dataset: 'students_choices',
        severity: 'warning',
        description: 'A student has fewer distinct subjects than the number of elective/theory subjects',
        run: (ctx) => {
            const rows = ctx.datasets.students_choices.filter((r) => !r.quarantined);
            // Count theory subjects in subjects dataset (these are the subjects students choose)
            const theorySubjectsCount = ctx.datasets.subjects.filter((s) => String(s.data.subject_type || '').toLowerCase() === 'theory').length;
            const studentSubjects = new Map();
            for (const row of rows) {
                const sId = row.data.student_id;
                const sub = row.data.subject_code;
                if (!sId || !sub)
                    continue;
                if (!studentSubjects.has(sId)) {
                    studentSubjects.set(sId, new Set());
                }
                studentSubjects.get(sId).add(sub);
            }
            for (const [sId, set] of studentSubjects.entries()) {
                if (set.size < theorySubjectsCount) {
                    ctx.addIssue({
                        rule_code: 'STU-012',
                        dataset: 'students_choices',
                        row_number: 0,
                        column: 'student_id',
                        severity: 'warning',
                        action_taken: null,
                        original_value: String(set.size),
                        new_value: String(theorySubjectsCount),
                        message: `Student ${sId} chose ${set.size} distinct subjects, fewer than required ${theorySubjectsCount} subjects`,
                    });
                }
            }
        },
    });
}
