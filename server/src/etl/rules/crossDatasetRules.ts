import { registerRule } from '../registry.js';
import { EtlContext } from '../types.js';

export function registerCrossDatasetRules(): void {
  // SUB-012: lab subject exists but no active computer_lab room exists (error, one per lab subject)
  registerRule({
    code: 'SUB-012',
    dataset: 'subjects',
    severity: 'error',
    description: 'A lab subject exists but no active computer_lab room exists',
    run: (ctx: EtlContext) => {
      const activeLabRooms = ctx.datasets.rooms.filter(
        (r) =>
          String(r.data.room_type || '').toLowerCase() === 'computer_lab' &&
          String(r.data.status || '').toLowerCase() === 'active'
      );

      if (activeLabRooms.length === 0) {
        for (const sub of ctx.datasets.subjects) {
          if (String(sub.data.subject_type || '').toLowerCase() === 'lab') {
            ctx.addIssue({
              rule_code: 'SUB-012',
              dataset: 'subjects',
              row_number: sub.row_number,
              column: 'required_room_type',
              severity: 'error',
              action_taken: null,
              original_value: 'computer_lab',
              new_value: null,
              message: `Lab subject ${sub.data.subject_code} requires a computer_lab, but no active computer_lab room exists in rooms dataset`,
            });
          }
        }
      }
    },
  });

  // SUB-013: no staff can teach this subject (error)
  registerRule({
    code: 'SUB-013',
    dataset: 'subjects',
    severity: 'error',
    description: 'No staff member can teach this subject',
    run: (ctx: EtlContext) => {
      const teachableCodes = new Set<string>();
      for (const stf of ctx.datasets.staff) {
        const canTeach = String(stf.data.subjects_can_teach || '')
          .split(';')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        canTeach.forEach((c) => teachableCodes.add(c));
      }

      for (const sub of ctx.datasets.subjects) {
        const code = String(sub.data.subject_code || '').toUpperCase();
        if (!teachableCodes.has(code)) {
          ctx.addIssue({
            rule_code: 'SUB-013',
            dataset: 'subjects',
            row_number: sub.row_number,
            column: 'subject_code',
            severity: 'error',
            action_taken: null,
            original_value: code,
            new_value: null,
            message: `No staff member is qualified to teach subject ${code}`,
          });
        }
      }
    },
  });

  // SUB-014: no student chose this subject (warning, for theory subjects)
  registerRule({
    code: 'SUB-014',
    dataset: 'subjects',
    severity: 'warning',
    description: 'No student chose this subject',
    run: (ctx: EtlContext) => {
      const chosenCodes = new Set<string>();
      for (const row of ctx.datasets.students_choices) {
        if (!row.quarantined && row.data.subject_code) {
          chosenCodes.add(String(row.data.subject_code).toUpperCase());
        }
      }

      for (const sub of ctx.datasets.subjects) {
        const type = String(sub.data.subject_type || '').toLowerCase();
        if (type !== 'theory') continue; // Lab subjects are not directly chosen by students

        const code = String(sub.data.subject_code || '').toUpperCase();
        if (!chosenCodes.has(code)) {
          ctx.addIssue({
            rule_code: 'SUB-014',
            dataset: 'subjects',
            row_number: sub.row_number,
            column: 'subject_code',
            severity: 'warning',
            action_taken: null,
            original_value: code,
            new_value: null,
            message: `No student chose subject ${code}`,
          });
        }
      }
    },
  });

  // ROM-009: no active classroom with capacity >= max_section_size (error, once)
  registerRule({
    code: 'ROM-009',
    dataset: 'rooms',
    severity: 'error',
    description: 'No active classroom with capacity >= max_section_size',
    run: (ctx: EtlContext) => {
      const maxSecSize = ctx.rules.max_section_size || 70;
      const validClassroom = ctx.datasets.rooms.some(
        (r) =>
          String(r.data.room_type || '').toLowerCase() === 'classroom' &&
          String(r.data.status || '').toLowerCase() === 'active' &&
          Number(r.data.capacity) >= maxSecSize
      );

      if (!validClassroom) {
        ctx.addIssue({
          rule_code: 'ROM-009',
          dataset: 'rooms',
          row_number: 0,
          column: 'capacity',
          severity: 'error',
          action_taken: null,
          original_value: null,
          new_value: String(maxSecSize),
          message: `No active classroom has capacity greater than or equal to max_section_size (${maxSecSize})`,
        });
      }
    },
  });

  // STF-010: hours_committed_elsewhere >= max_hours_per_week (warning)
  registerRule({
    code: 'STF-010',
    dataset: 'staff',
    severity: 'warning',
    description: 'hours_committed_elsewhere >= max_hours_per_week',
    run: (ctx: EtlContext) => {
      for (const stf of ctx.datasets.staff) {
        const max = Number(stf.data.max_hours_per_week) || 0;
        const comm = Number(stf.data.hours_committed_elsewhere) || 0;
        if (comm >= max && max > 0) {
          ctx.addIssue({
            rule_code: 'STF-010',
            dataset: 'staff',
            row_number: stf.row_number,
            column: 'hours_committed_elsewhere',
            severity: 'warning',
            action_taken: null,
            original_value: String(comm),
            new_value: String(max),
            message: `Staff member ${stf.data.staff_id} hours committed elsewhere (${comm}) is greater than or equal to max hours (${max})`,
          });
        }
      }
    },
  });

  // STF-011: weekly load greater than max_hours_per_week minus hours_committed_elsewhere
  // Load = sum of hours_per_week over the distinct (subject, staff) sections in the cleaned choices
  registerRule({
    code: 'STF-011',
    dataset: 'staff',
    severity: 'warning',
    description: 'Weekly load greater than max_hours_per_week minus hours_committed_elsewhere',
    run: (ctx: EtlContext) => {
      // Map subject_code -> hours_per_week
      const subjectHpW = new Map<string, number>();
      for (const s of ctx.datasets.subjects) {
        const code = String(s.data.subject_code || '').toUpperCase();
        subjectHpW.set(code, Number(s.data.hours_per_week) || 0);
      }

      // Find distinct (subject, staff) pairs in surviving choices
      const distinctSections = new Set<string>();
      for (const sc of ctx.datasets.students_choices) {
        if (!sc.quarantined && sc.data.subject_code && sc.data.staff_id) {
          const sub = String(sc.data.subject_code).toUpperCase();
          const stf = String(sc.data.staff_id).toUpperCase();
          distinctSections.add(`${sub}::${stf}`);
        }
      }

      // Calculate load per staff
      const staffLoad = new Map<string, number>();
      for (const sec of distinctSections) {
        const [sub, stf] = sec.split('::');
        const hpw = subjectHpW.get(sub) || 0;
        staffLoad.set(stf, (staffLoad.get(stf) || 0) + hpw);
      }

      const maxDaily = ctx.rules.max_staff_periods_per_day || 4;

      for (const stf of ctx.datasets.staff) {
        const stfId = String(stf.data.staff_id || '').toUpperCase();
        const maxWeekly = Number(stf.data.max_hours_per_week) || 0;
        const comm = Number(stf.data.hours_committed_elsewhere) || 0;
        const availableWeekly = Math.max(0, maxWeekly - comm);
        const load = staffLoad.get(stfId) || 0;

        // Triggers if load exceeds available weekly hours or daily scheduling cap
        if (load > availableWeekly || load > maxDaily) {
          ctx.addIssue({
            rule_code: 'STF-011',
            dataset: 'staff',
            row_number: stf.row_number,
            column: 'max_hours_per_week',
            severity: 'warning',
            action_taken: null,
            original_value: String(load),
            new_value: String(availableWeekly),
            message: `Staff member ${stfId} weekly load (${load} hrs across assigned sections) exceeds available capacity (${availableWeekly} hrs, daily cap ${maxDaily} hrs)`,
          });
        }
      }
    },
  });
}
