import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from '../server/src/etl/registry.js';
import { initRules } from '../server/src/etl/runner.js';
import { EtlContext } from '../server/src/etl/types.js';

describe('ETL Individual Rules Unit Tests', () => {
  beforeEach(() => {
    initRules();
  });

  const createMockContext = (overrides?: Partial<EtlContext>): EtlContext => {
    const issues: any[] = [];
    return {
      rules: {
        semester_name: 'Fall 2026',
        academic_year: '2026-2027',
        department: 'CSE',
        semester_start: '2026-07-06', // Monday
        semester_end: '2026-11-27',
        working_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        saturday_makeup_allowed: false,
        periods_per_day: 7,
        periods: [
          { period: 1, start: '08:30', end: '09:20' },
          { period: 2, start: '09:25', end: '10:15' },
          { period: 3, start: '10:30', end: '11:20' },
          { period: 4, start: '11:25', end: '12:15' },
          { period: 5, start: '13:15', end: '14:05' },
          { period: 6, start: '14:10', end: '15:00' },
          { period: 7, start: '15:05', end: '15:55' },
        ],
        teaching_weeks_planned: 16,
        default_section_size: 60,
        min_section_size: 30,
        max_section_size: 70,
        max_consecutive_theory_periods: 2,
        max_staff_periods_per_day: 4,
        timezone: 'Asia/Kolkata',
      },
      datasets: {
        subjects: [],
        rooms: [],
        staff: [],
        holidays: [],
        students_choices: [],
      },
      issues,
      addIssue: (issue) => issues.push(issue),
      cleaned: {
        subjects: [],
        rooms: [],
        staff: [],
        staff_subjects: [],
        holidays: [],
        students: [],
        student_choices: [],
      },
      ...overrides,
    };
  };

  describe('Rules Dataset (RUL-001, RUL-003, RUL-004, RUL-005)', () => {
    it('RUL-001 should flag error when period count does not equal periods_per_day', () => {
      const ctx = createMockContext();
      ctx.rules.periods_per_day = 8; // Mismatch: 7 periods vs 8 per day
      registry.get('RUL-001')!.run(ctx);
      expect(ctx.issues).toHaveLength(1);
      expect(ctx.issues[0].rule_code).toBe('RUL-001');
      expect(ctx.issues[0].severity).toBe('error');
    });

    it('RUL-003 should flag error when min <= default <= max section size is violated', () => {
      const ctx = createMockContext();
      ctx.rules.min_section_size = 65;
      ctx.rules.default_section_size = 60; // 65 > 60
      registry.get('RUL-003')!.run(ctx);
      expect(ctx.issues).toHaveLength(1);
      expect(ctx.issues[0].rule_code).toBe('RUL-003');
    });

    it('RUL-004 should flag error when semester_end is not after semester_start', () => {
      const ctx = createMockContext();
      ctx.rules.semester_start = '2026-11-27';
      ctx.rules.semester_end = '2026-07-06';
      registry.get('RUL-004')!.run(ctx);
      expect(ctx.issues).toHaveLength(1);
      expect(ctx.issues[0].rule_code).toBe('RUL-004');
    });

    it('RUL-005 should flag warning when semester_start is not a Monday', () => {
      const ctx = createMockContext();
      ctx.rules.semester_start = '2026-07-07'; // Tuesday
      registry.get('RUL-005')!.run(ctx);
      expect(ctx.issues).toHaveLength(1);
      expect(ctx.issues[0].rule_code).toBe('RUL-005');
      expect(ctx.issues[0].severity).toBe('warning');
    });
  });

  describe('Subjects Rules (SUB-001 through SUB-011)', () => {
    it('SUB-001 & SUB-002 should trim whitespace and normalize casing', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        {
          row_number: 1,
          raw: {},
          data: {
            subject_code: '  cs101  ',
            department: ' computer science ',
            subject_type: ' THEORY ',
            required_room_type: ' CLASSROOM ',
          },
        },
      ];

      registry.get('SUB-001')!.run(ctx);
      expect(ctx.datasets.subjects[0].data.subject_code).toBe('cs101');
      expect(ctx.datasets.subjects[0].data.department).toBe('computer science');
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-001')).toBe(true);

      registry.get('SUB-002')!.run(ctx);
      expect(ctx.datasets.subjects[0].data.subject_code).toBe('CS101');
      expect(ctx.datasets.subjects[0].data.department).toBe('COMPUTER SCIENCE');
      expect(ctx.datasets.subjects[0].data.subject_type).toBe('theory');
      expect(ctx.datasets.subjects[0].data.required_room_type).toBe('classroom');
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-002')).toBe(true);
    });

    it('SUB-003 should remove exact duplicate rows', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        { row_number: 1, raw: {}, data: { subject_code: 'CS101', name: 'DSA' } },
        { row_number: 2, raw: {}, data: { subject_code: 'CS101', name: 'DSA' } },
      ];
      registry.get('SUB-003')!.run(ctx);
      expect(ctx.datasets.subjects).toHaveLength(1);
      expect(ctx.issues.filter((i) => i.rule_code === 'SUB-003')).toHaveLength(1);
      expect(ctx.issues[0].action_taken).toBe('removed');
    });

    it('SUB-004 should flag conflicting rows with same subject_code but different values', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        { row_number: 1, raw: {}, data: { subject_code: 'CS101', credits: 3 } },
        { row_number: 2, raw: {}, data: { subject_code: 'CS101', credits: 4 } },
      ];
      registry.get('SUB-004')!.run(ctx);
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-004')).toBe(true);
    });

    it('SUB-005, SUB-006, SUB-007 should auto-fill blanks correctly', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        {
          row_number: 1,
          raw: {},
          data: {
            subject_code: 'CS101',
            subject_type: 'theory',
            hours_per_week: 4,
            lab_block_periods: '',
            required_room_type: '',
            total_hours: '',
          },
        },
        {
          row_number: 2,
          raw: {},
          data: {
            subject_code: 'CS102',
            subject_type: 'lab',
            hours_per_week: 3,
            lab_block_periods: '',
            required_room_type: '',
            total_hours: '',
          },
        },
      ];

      registry.get('SUB-005')!.run(ctx);
      expect(ctx.datasets.subjects[0].data.lab_block_periods).toBe(1);
      expect(ctx.datasets.subjects[1].data.lab_block_periods).toBe(3);

      registry.get('SUB-006')!.run(ctx);
      expect(ctx.datasets.subjects[0].data.required_room_type).toBe('classroom');
      expect(ctx.datasets.subjects[1].data.required_room_type).toBe('computer_lab');

      registry.get('SUB-007')!.run(ctx);
      expect(ctx.datasets.subjects[0].data.total_hours).toBe(64); // 4 * 16
      expect(ctx.datasets.subjects[1].data.total_hours).toBe(48); // 3 * 16
    });

    it('SUB-008 & SUB-009 should validate hours_per_week and subject_type', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        { row_number: 1, raw: {}, data: { hours_per_week: -2, subject_type: 'seminar' } },
      ];
      registry.get('SUB-008')!.run(ctx);
      registry.get('SUB-009')!.run(ctx);
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-008')).toBe(true);
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-009')).toBe(true);
    });

    it('SUB-010 should flag lab_block_periods greater than periods_per_day', () => {
      const ctx = createMockContext();
      ctx.rules.periods_per_day = 6;
      ctx.datasets.subjects = [
        { row_number: 1, raw: {}, data: { lab_block_periods: 7 } },
      ];
      registry.get('SUB-010')!.run(ctx);
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-010')).toBe(true);
    });

    it('SUB-011 should warn when pre-existing total_hours differs from hours_per_week * weeks', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        { row_number: 1, raw: {}, data: { hours_per_week: 3, total_hours: 40 } }, // 3*16 = 48 != 40
      ];
      registry.get('SUB-011')!.run(ctx);
      expect(ctx.issues.some((i) => i.rule_code === 'SUB-011')).toBe(true);
    });
  });

  describe('Rooms Rules (ROM-001 through ROM-008)', () => {
    it('ROM-002 should parse boolean columns case-insensitively with no issue', () => {
      const ctx = createMockContext();
      ctx.datasets.rooms = [
        {
          row_number: 1,
          raw: {},
          data: { room_id: 'lh-1', room_type: 'CLASSROOM', status: 'ACTIVE', has_projector: 'True', is_ac: 'FALSE' },
        },
      ];
      registry.get('ROM-002')!.run(ctx);
      expect(ctx.datasets.rooms[0].data.room_id).toBe('LH-1');
      expect(ctx.datasets.rooms[0].data.room_type).toBe('classroom');
      expect(ctx.datasets.rooms[0].data.has_projector).toBe(true);
      expect(ctx.datasets.rooms[0].data.is_ac).toBe(false);
      // No boolean casing issue emitted
      expect(ctx.issues.some((i) => i.column === 'has_projector')).toBe(false);
    });

    it('ROM-005 & ROM-006 should fill blank projector, ac, and status', () => {
      const ctx = createMockContext();
      ctx.datasets.rooms = [
        { row_number: 1, raw: {}, data: { has_projector: '', is_ac: null, status: '' } },
      ];
      registry.get('ROM-005')!.run(ctx);
      expect(ctx.datasets.rooms[0].data.has_projector).toBe(false);
      expect(ctx.datasets.rooms[0].data.is_ac).toBe(false);

      registry.get('ROM-006')!.run(ctx);
      expect(ctx.datasets.rooms[0].data.status).toBe('active');
    });

    it('ROM-007 & ROM-008 should validate capacity and enum lists', () => {
      const ctx = createMockContext();
      ctx.datasets.rooms = [
        { row_number: 1, raw: {}, data: { capacity: 0, room_type: 'library', status: 'closed' } },
      ];
      registry.get('ROM-007')!.run(ctx);
      registry.get('ROM-008')!.run(ctx);
      expect(ctx.issues.some((i) => i.rule_code === 'ROM-007')).toBe(true);
      expect(ctx.issues.some((i) => i.rule_code === 'ROM-008' && i.column === 'room_type')).toBe(true);
      expect(ctx.issues.some((i) => i.rule_code === 'ROM-008' && i.column === 'status')).toBe(true);
    });
  });

  describe('Staff Rules (STF-001 through STF-012)', () => {
    it('STF-005 should fill blank max_hours_per_week from designation average', () => {
      const ctx = createMockContext();
      ctx.datasets.staff = [
        { row_number: 1, raw: {}, data: { designation: 'Assistant Professor', max_hours_per_week: 18 } },
        { row_number: 2, raw: {}, data: { designation: 'Assistant Professor', max_hours_per_week: 22 } },
        { row_number: 3, raw: {}, data: { designation: 'Assistant Professor', max_hours_per_week: '' } },
      ];
      registry.get('STF-005')!.run(ctx);
      expect(ctx.datasets.staff[2].data.max_hours_per_week).toBe(20); // (18 + 22) / 2
    });

    it('STF-007 should drop unknown subjects from subjects_can_teach', () => {
      const ctx = createMockContext();
      ctx.datasets.subjects = [
        { row_number: 1, raw: {}, data: { subject_code: 'CS101' } },
      ];
      ctx.datasets.staff = [
        { row_number: 1, raw: {}, data: { staff_id: 'STF001', subjects_can_teach: 'CS101;CS999' } },
      ];
      registry.get('STF-007')!.run(ctx);
      expect(ctx.datasets.staff[0].data.subjects_can_teach).toBe('CS101');
      expect(ctx.issues.some((i) => i.rule_code === 'STF-007' && i.original_value === 'CS999')).toBe(true);
    });

    it('STF-009 should warn on invalid email format', () => {
      const ctx = createMockContext();
      ctx.datasets.staff = [
        { row_number: 1, raw: {}, data: { staff_id: 'STF1', email: 'invalid-email-address' } },
      ];
      registry.get('STF-009')!.run(ctx);
      expect(ctx.issues.some((i) => i.rule_code === 'STF-009')).toBe(true);
    });
  });

  describe('Holidays Rules (HOL-001 through HOL-006)', () => {
    it('HOL-003 should swap date_from and date_to when from > to', () => {
      const ctx = createMockContext();
      ctx.datasets.holidays = [
        { row_number: 1, raw: {}, data: { date_from: '2026-08-20', date_to: '2026-08-15' } },
      ];
      registry.get('HOL-003')!.run(ctx);
      expect(ctx.datasets.holidays[0].data.date_from).toBe('2026-08-15');
      expect(ctx.datasets.holidays[0].data.date_to).toBe('2026-08-20');
      expect(ctx.issues.some((i) => i.rule_code === 'HOL-003')).toBe(true);
    });

    it('HOL-004 should mark holiday ignored=1 when completely outside semester', () => {
      const ctx = createMockContext();
      ctx.rules.semester_start = '2026-07-06';
      ctx.rules.semester_end = '2026-11-27';
      ctx.datasets.holidays = [
        { row_number: 1, raw: {}, data: { date_from: '2026-12-01', date_to: '2026-12-05' } },
      ];
      registry.get('HOL-004')!.run(ctx);
      expect(ctx.datasets.holidays[0].data.ignored).toBe(1);
      expect(ctx.issues.some((i) => i.rule_code === 'HOL-004')).toBe(true);
    });
  });

  describe('Students Choices Rules (STU-001 through STU-016)', () => {
    it('STU-004 should resolve conflicting choices keeping earliest selected_at', () => {
      const ctx = createMockContext();
      ctx.datasets.students_choices = [
        {
          row_number: 1,
          raw: {},
          data: {
            student_id: 'STU01',
            subject_code: 'CS101',
            staff_id: 'STF01',
            selected_at: '2026-06-15 12:00:00',
          },
        },
        {
          row_number: 2,
          raw: {},
          data: {
            student_id: 'STU01',
            subject_code: 'CS101',
            staff_id: 'STF02',
            selected_at: '2026-06-15 10:00:00', // Earliest!
          },
        },
      ];

      registry.get('STU-004')!.run(ctx);
      expect(ctx.datasets.students_choices[0].quarantined).toBe(true);
      expect(ctx.datasets.students_choices[1].quarantined).toBeFalsy();
      expect(ctx.issues.some((i) => i.rule_code === 'STU-004')).toBe(true);
    });

    it('STU-005 should auto-fill missing department from rules when none exist', () => {
      const ctx = createMockContext();
      ctx.rules.department = 'Computer Science';
      ctx.datasets.students_choices = [
        {
          row_number: 1,
          raw: {},
          data: { student_id: 'STU1', department: '' },
        },
      ];
      registry.get('STU-005')!.run(ctx);
      expect(ctx.datasets.students_choices[0].data.department).toBe('Computer Science');
      expect(ctx.issues.some((i) => i.rule_code === 'STU-005')).toBe(true);
    });
  });
});
