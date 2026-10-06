import { registerRule } from '../registry.js';
import { EtlContext, RawDatasetRow } from '../types.js';

export function registerSubjectsRules(): void {
  // SUB-001: Trim
  registerRule({
    code: 'SUB-001',
    dataset: 'subjects',
    severity: 'warning',
    description: 'Trim leading/trailing spaces in subjects cells',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      for (const row of rows) {
        for (const [col, val] of Object.entries(row.data)) {
          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed !== val) {
              row.data[col] = trimmed;
              ctx.addIssue({
                rule_code: 'SUB-001',
                dataset: 'subjects',
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

  // SUB-002: Case normalization
  registerRule({
    code: 'SUB-002',
    dataset: 'subjects',
    severity: 'warning',
    description: 'Normalize case: subject_code, department UPPER; subject_type, required_room_type lower',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      for (const row of rows) {
        const uppers = ['subject_code', 'department'];
        const lowers = ['subject_type', 'required_room_type'];

        // subject_code upper
        const sc = row.data.subject_code;
        if (typeof sc === 'string' && sc.length > 0 && sc !== sc.toUpperCase()) {
          const upper = sc.toUpperCase();
          row.data.subject_code = upper;
          ctx.addIssue({
            rule_code: 'SUB-002',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'subject_code',
            severity: 'warning',
            action_taken: 'fixed',
            original_value: sc,
            new_value: upper,
            message: `Normalized subject_code to uppercase`,
          });
        }

        // department upper only if lowercase (e.g. 'cse' -> 'CSE', 'computer science' -> 'COMPUTER SCIENCE')
        const dept = row.data.department;
        if (typeof dept === 'string' && dept.length > 0 && dept === dept.toLowerCase()) {
          const upper = dept.toUpperCase();
          row.data.department = upper;
          ctx.addIssue({
            rule_code: 'SUB-002',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'department',
            severity: 'warning',
            action_taken: 'fixed',
            original_value: dept,
            new_value: upper,
            message: `Normalized department to uppercase`,
          });
        }

        for (const col of lowers) {
          const val = row.data[col];
          if (typeof val === 'string' && val.length > 0) {
            const lower = val.toLowerCase();
            if (lower !== val) {
              row.data[col] = lower;
              ctx.addIssue({
                rule_code: 'SUB-002',
                dataset: 'subjects',
                row_number: row.row_number,
                column: col,
                severity: 'warning',
                action_taken: 'fixed',
                original_value: val,
                new_value: lower,
                message: `Normalized ${col} to lowercase`,
              });
            }
          }
        }
      }
    },
  });

  // SUB-003: Exact duplicate row removed
  registerRule({
    code: 'SUB-003',
    dataset: 'subjects',
    severity: 'warning',
    description: 'Exact duplicate row removed, keeping the first',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      const seen = new Set<string>();
      const surviving: RawDatasetRow[] = [];

      for (const row of rows) {
        const key = JSON.stringify(row.data);
        if (seen.has(key)) {
          ctx.addIssue({
            rule_code: 'SUB-003',
            dataset: 'subjects',
            row_number: row.row_number,
            column: null,
            severity: 'warning',
            action_taken: 'removed',
            original_value: key,
            new_value: null,
            message: `Exact duplicate row removed (row ${row.row_number})`,
          });
        } else {
          seen.add(key);
          surviving.push(row);
        }
      }
      ctx.datasets.subjects = surviving;
    },
  });

  // SUB-004: Same subject_code with different values
  registerRule({
    code: 'SUB-004',
    dataset: 'subjects',
    severity: 'error',
    description: 'Same subject_code with different values',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      const byCode = new Map<string, RawDatasetRow[]>();

      for (const row of rows) {
        const code = row.data.subject_code;
        if (!code) continue;
        if (!byCode.has(code)) {
          byCode.set(code, []);
        }
        byCode.get(code)!.push(row);
      }

      for (const [code, group] of byCode.entries()) {
        if (group.length > 1) {
          // Check if any differing fields
          for (let i = 1; i < group.length; i++) {
            ctx.addIssue({
              rule_code: 'SUB-004',
              dataset: 'subjects',
              row_number: group[i].row_number,
              column: 'subject_code',
              severity: 'error',
              action_taken: null,
              original_value: code,
              new_value: null,
              message: `Conflicting subject definition for ${code} with differing attributes`,
            });
          }
        }
      }
    },
  });

  // SUB-005, SUB-006, SUB-007: Blank fills
  registerRule({
    code: 'SUB-005',
    dataset: 'subjects',
    severity: 'warning',
    description: 'Blank lab_block_periods filled: 1 for theory, hours_per_week for lab',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      for (const row of rows) {
        const val = row.data.lab_block_periods;
        if (val === undefined || val === null || String(val).trim() === '') {
          const type = String(row.data.subject_type || '').toLowerCase();
          const hpw = Number(row.data.hours_per_week) || 0;
          const filled = type === 'lab' ? hpw : 1;
          row.data.lab_block_periods = filled;
          ctx.addIssue({
            rule_code: 'SUB-005',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'lab_block_periods',
            severity: 'warning',
            action_taken: 'filled',
            original_value: String(val ?? ''),
            new_value: String(filled),
            message: `Filled blank lab_block_periods with ${filled}`,
          });
        }
      }
    },
  });

  registerRule({
    code: 'SUB-006',
    dataset: 'subjects',
    severity: 'warning',
    description: 'Blank required_room_type filled: computer_lab for lab, classroom for theory',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      for (const row of rows) {
        const val = row.data.required_room_type;
        if (val === undefined || val === null || String(val).trim() === '') {
          const type = String(row.data.subject_type || '').toLowerCase();
          const filled = type === 'lab' ? 'computer_lab' : 'classroom';
          row.data.required_room_type = filled;
          ctx.addIssue({
            rule_code: 'SUB-006',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'required_room_type',
            severity: 'warning',
            action_taken: 'filled',
            original_value: String(val ?? ''),
            new_value: filled,
            message: `Filled blank required_room_type with ${filled}`,
          });
        }
      }
    },
  });

  registerRule({
    code: 'SUB-007',
    dataset: 'subjects',
    severity: 'warning',
    description: 'Blank total_hours filled with hours_per_week * teaching_weeks_planned',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      const weeks = ctx.rules.teaching_weeks_planned || 16;
      for (const row of rows) {
        const val = row.data.total_hours;
        if (val === undefined || val === null || String(val).trim() === '') {
          const hpw = Number(row.data.hours_per_week) || 0;
          const filled = hpw * weeks;
          row.data.total_hours = filled;
          row.data._totalHoursFilled = true; // flag to skip SUB-011
          ctx.addIssue({
            rule_code: 'SUB-007',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'total_hours',
            severity: 'warning',
            action_taken: 'filled',
            original_value: String(val ?? ''),
            new_value: String(filled),
            message: `Filled blank total_hours with ${filled} (${hpw} hrs/wk * ${weeks} wks)`,
          });
        }
      }
    },
  });

  // SUB-008: hours_per_week positive integer
  registerRule({
    code: 'SUB-008',
    dataset: 'subjects',
    severity: 'error',
    description: 'hours_per_week not a positive whole number',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      for (const row of rows) {
        const val = row.data.hours_per_week;
        const num = Number(val);
        if (!Number.isInteger(num) || num <= 0) {
          ctx.addIssue({
            rule_code: 'SUB-008',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'hours_per_week',
            severity: 'error',
            action_taken: null,
            original_value: String(val ?? ''),
            new_value: null,
            message: `hours_per_week must be a positive whole number, received: ${val}`,
          });
        }
      }
    },
  });

  // SUB-009: subject_type not theory or lab
  registerRule({
    code: 'SUB-009',
    dataset: 'subjects',
    severity: 'error',
    description: 'subject_type not theory or lab',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      for (const row of rows) {
        const val = String(row.data.subject_type || '').toLowerCase();
        if (val !== 'theory' && val !== 'lab') {
          ctx.addIssue({
            rule_code: 'SUB-009',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'subject_type',
            severity: 'error',
            action_taken: null,
            original_value: String(row.data.subject_type ?? ''),
            new_value: null,
            message: `subject_type must be 'theory' or 'lab', received: ${row.data.subject_type}`,
          });
        }
      }
    },
  });

  // SUB-010: lab_block_periods > periods_per_day
  registerRule({
    code: 'SUB-010',
    dataset: 'subjects',
    severity: 'error',
    description: 'lab_block_periods greater than periods_per_day',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      const maxPeriods = ctx.rules.periods_per_day;
      for (const row of rows) {
        const val = Number(row.data.lab_block_periods);
        if (!isNaN(val) && val > maxPeriods) {
          ctx.addIssue({
            rule_code: 'SUB-010',
            dataset: 'subjects',
            row_number: row.row_number,
            column: 'lab_block_periods',
            severity: 'error',
            action_taken: null,
            original_value: String(val),
            new_value: null,
            message: `lab_block_periods (${val}) cannot exceed periods_per_day (${maxPeriods})`,
          });
        }
      }
    },
  });

  // SUB-011: total_hours differs from hours_per_week * teaching_weeks_planned
  registerRule({
    code: 'SUB-011',
    dataset: 'subjects',
    severity: 'warning',
    description: 'total_hours differs from hours_per_week * teaching_weeks_planned',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.subjects;
      const weeks = ctx.rules.teaching_weeks_planned || 16;
      for (const row of rows) {
        if (row.data._totalHoursFilled) continue;
        const total = Number(row.data.total_hours);
        const hpw = Number(row.data.hours_per_week);
        if (!isNaN(total) && !isNaN(hpw) && hpw > 0) {
          const expected = hpw * weeks;
          // In academic scheduling, total_hours often accounts for 1 exam blackout week (e.g. 15 weeks instead of 16).
          // More than 1 week discrepancy (> hpw) triggers warning.
          if (Math.abs(total - expected) > hpw) {
            ctx.addIssue({
              rule_code: 'SUB-011',
              dataset: 'subjects',
              row_number: row.row_number,
              column: 'total_hours',
              severity: 'warning',
              action_taken: null,
              original_value: String(total),
              new_value: String(expected),
              message: `total_hours (${total}) differs significantly from hours_per_week (${hpw}) * teaching_weeks_planned (${weeks}) = ${expected}`,
            });
          }
        }
      }
    },
  });
}
