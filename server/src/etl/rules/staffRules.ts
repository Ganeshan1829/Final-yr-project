import { registerRule } from '../registry.js';
import { EtlContext, RawDatasetRow } from '../types.js';

export function registerStaffRules(): void {
  // STF-001: Trim
  registerRule({
    code: 'STF-001',
    dataset: 'staff',
    severity: 'warning',
    description: 'Trim leading/trailing spaces in staff cells',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      for (const row of rows) {
        for (const [col, val] of Object.entries(row.data)) {
          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed !== val) {
              row.data[col] = trimmed;
              ctx.addIssue({
                rule_code: 'STF-001',
                dataset: 'staff',
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

  // STF-002: Case normalization
  registerRule({
    code: 'STF-002',
    dataset: 'staff',
    severity: 'warning',
    description: 'Normalize case: staff_id, department, subjects_can_teach UPPER; email lower',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      for (const row of rows) {
        for (const col of ['staff_id', 'subjects_can_teach']) {
          const val = row.data[col];
          if (typeof val === 'string' && val.length > 0) {
            const upper = val.toUpperCase();
            if (upper !== val) {
              row.data[col] = upper;
              ctx.addIssue({
                rule_code: 'STF-002',
                dataset: 'staff',
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
            rule_code: 'STF-002',
            dataset: 'staff',
            row_number: row.row_number,
            column: 'department',
            severity: 'warning',
            action_taken: 'fixed',
            original_value: dept,
            new_value: upper,
            message: `Normalized department to uppercase`,
          });
        }

        const email = row.data.email;
        if (typeof email === 'string' && email.length > 0) {
          const lower = email.toLowerCase();
          if (lower !== email) {
            row.data.email = lower;
            ctx.addIssue({
              rule_code: 'STF-002',
              dataset: 'staff',
              row_number: row.row_number,
              column: 'email',
              severity: 'warning',
              action_taken: 'fixed',
              original_value: email,
              new_value: lower,
              message: `Normalized email to lowercase`,
            });
          }
        }
      }
    },
  });

  // STF-003: Exact duplicate removed
  registerRule({
    code: 'STF-003',
    dataset: 'staff',
    severity: 'warning',
    description: 'Exact duplicate row removed, keeping the first',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      const seen = new Set<string>();
      const surviving: RawDatasetRow[] = [];

      for (const row of rows) {
        const key = JSON.stringify(row.data);
        if (seen.has(key)) {
          ctx.addIssue({
            rule_code: 'STF-003',
            dataset: 'staff',
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
      ctx.datasets.staff = surviving;
    },
  });

  // STF-004: Same staff_id with different values
  registerRule({
    code: 'STF-004',
    dataset: 'staff',
    severity: 'error',
    description: 'Same staff_id with different values',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      const byId = new Map<string, RawDatasetRow[]>();

      for (const row of rows) {
        const id = row.data.staff_id;
        if (!id) continue;
        if (!byId.has(id)) {
          byId.set(id, []);
        }
        byId.get(id)!.push(row);
      }

      for (const [id, group] of byId.entries()) {
        if (group.length > 1) {
          for (let i = 1; i < group.length; i++) {
            ctx.addIssue({
              rule_code: 'STF-004',
              dataset: 'staff',
              row_number: group[i].row_number,
              column: 'staff_id',
              severity: 'error',
              action_taken: null,
              original_value: id,
              new_value: null,
              message: `Conflicting staff definition for ${id} with differing attributes`,
            });
          }
        }
      }
    },
  });

  // STF-005: Blank max_hours_per_week filled
  registerRule({
    code: 'STF-005',
    dataset: 'staff',
    severity: 'warning',
    description: 'Blank max_hours_per_week filled with rounded average of same designation, else 16',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      const designationHours = new Map<string, number[]>();

      for (const row of rows) {
        const desig = String(row.data.designation || '').trim();
        const val = row.data.max_hours_per_week;
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          const num = Number(val);
          if (!isNaN(num) && num > 0) {
            if (!designationHours.has(desig)) {
              designationHours.set(desig, []);
            }
            designationHours.get(desig)!.push(num);
          }
        }
      }

      for (const row of rows) {
        const val = row.data.max_hours_per_week;
        if (val === undefined || val === null || String(val).trim() === '') {
          const desig = String(row.data.designation || '').trim();
          const list = designationHours.get(desig) || [];
          let filled = 16;
          if (list.length > 0) {
            const sum = list.reduce((a, b) => a + b, 0);
            filled = Math.round(sum / list.length);
          }
          row.data.max_hours_per_week = filled;
          ctx.addIssue({
            rule_code: 'STF-005',
            dataset: 'staff',
            row_number: row.row_number,
            column: 'max_hours_per_week',
            severity: 'warning',
            action_taken: 'filled',
            original_value: String(val ?? ''),
            new_value: String(filled),
            message: `Filled blank max_hours_per_week with ${filled}`,
          });
        }
      }
    },
  });

  // STF-006: Blank hours_committed_elsewhere filled with 0
  registerRule({
    code: 'STF-006',
    dataset: 'staff',
    severity: 'warning',
    description: 'Blank hours_committed_elsewhere filled with 0',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      for (const row of rows) {
        const val = row.data.hours_committed_elsewhere;
        if (val === undefined || val === null || String(val).trim() === '') {
          row.data.hours_committed_elsewhere = 0;
          ctx.addIssue({
            rule_code: 'STF-006',
            dataset: 'staff',
            row_number: row.row_number,
            column: 'hours_committed_elsewhere',
            severity: 'warning',
            action_taken: 'filled',
            original_value: String(val ?? ''),
            new_value: '0',
            message: `Filled blank hours_committed_elsewhere with 0`,
          });
        }
      }
    },
  });

  // STF-007 & STF-008: subjects_can_teach validation & dropping invalid codes
  registerRule({
    code: 'STF-007',
    dataset: 'staff',
    severity: 'warning',
    description: 'subjects_can_teach contains a code not in subjects: code is dropped',
    run: (ctx: EtlContext) => {
      const validCodes = new Set(
        ctx.datasets.subjects.map((r) => String(r.data.subject_code || '').toUpperCase())
      );
      const rows = ctx.datasets.staff;

      for (const row of rows) {
        const rawCanTeach = String(row.data.subjects_can_teach || '').trim();
        if (!rawCanTeach) continue;

        const codes = rawCanTeach
          .split(';')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        const keptCodes: string[] = [];

        for (const code of codes) {
          if (!validCodes.has(code)) {
            ctx.addIssue({
              rule_code: 'STF-007',
              dataset: 'staff',
              row_number: row.row_number,
              column: 'subjects_can_teach',
              severity: 'warning',
              action_taken: 'dropped',
              original_value: code,
              new_value: null,
              message: `Dropped unknown subject code '${code}' from subjects_can_teach for staff ${row.data.staff_id}`,
            });
          } else {
            keptCodes.push(code);
          }
        }

        row.data.subjects_can_teach = keptCodes.join(';');
      }
    },
  });

  registerRule({
    code: 'STF-008',
    dataset: 'staff',
    severity: 'warning',
    description: 'subjects_can_teach is empty after STF-007',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      for (const row of rows) {
        const canTeach = String(row.data.subjects_can_teach || '').trim();
        if (!canTeach) {
          ctx.addIssue({
            rule_code: 'STF-008',
            dataset: 'staff',
            row_number: row.row_number,
            column: 'subjects_can_teach',
            severity: 'warning',
            action_taken: null,
            original_value: '',
            new_value: null,
            message: `Staff member ${row.data.staff_id} has no subjects they can teach`,
          });
        }
      }
    },
  });

  // STF-009: Email blank or not valid format
  registerRule({
    code: 'STF-009',
    dataset: 'staff',
    severity: 'warning',
    description: 'email blank or not a valid format',
    run: (ctx: EtlContext) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const rows = ctx.datasets.staff;
      for (const row of rows) {
        const email = String(row.data.email || '').trim();
        if (!email || !emailRegex.test(email)) {
          ctx.addIssue({
            rule_code: 'STF-009',
            dataset: 'staff',
            row_number: row.row_number,
            column: 'email',
            severity: 'warning',
            action_taken: null,
            original_value: email || null,
            new_value: null,
            message: `Staff member ${row.data.staff_id} has invalid or blank email address: '${email}'`,
          });
        }
      }
    },
  });

  // STF-012: max_hours_per_week not a whole number
  registerRule({
    code: 'STF-012',
    dataset: 'staff',
    severity: 'error',
    description: 'max_hours_per_week not a whole number',
    run: (ctx: EtlContext) => {
      const rows = ctx.datasets.staff;
      for (const row of rows) {
        const val = row.data.max_hours_per_week;
        const num = Number(val);
        if (!Number.isInteger(num) || num <= 0) {
          ctx.addIssue({
            rule_code: 'STF-012',
            dataset: 'staff',
            row_number: row.row_number,
            column: 'max_hours_per_week',
            severity: 'error',
            action_taken: null,
            original_value: String(val ?? ''),
            new_value: null,
            message: `max_hours_per_week must be a whole positive number, received: ${val}`,
          });
        }
      }
    },
  });
}
