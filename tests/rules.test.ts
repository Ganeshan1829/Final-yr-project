import { describe, it, expect } from 'vitest';
import { RulesFormSchema } from '../server/src/schemas/rules.js';

describe('Rules Schema Unit Tests', () => {
  const validBaseRules = {
    semester_name: 'Spring 2027',
    academic_year: '2026-2027',
    department: 'Computer Science',
    semester_start: '2027-01-04',
    semester_end: '2027-05-28',
    working_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    saturday_makeup_allowed: false,
    periods_per_day: 3,
    periods: [
      { period: 1, start: '09:00', end: '09:50' },
      { period: 2, start: '10:00', end: '10:50' },
      { period: 3, start: '11:00', end: '11:50' },
    ],
    teaching_weeks_planned: 16,
    default_section_size: 60,
    min_section_size: 30,
    max_section_size: 70,
    max_consecutive_theory_periods: 2,
    max_staff_periods_per_day: 4,
    timezone: 'Asia/Kolkata',
  };

  it('should accept valid rules configuration', () => {
    const parsed = RulesFormSchema.safeParse(validBaseRules);
    expect(parsed.success).toBe(true);
  });

  it('should reject when semester_end is on or before semester_start', () => {
    const invalidDates = {
      ...validBaseRules,
      semester_start: '2027-05-28',
      semester_end: '2027-01-04',
    };

    const parsed = RulesFormSchema.safeParse(invalidDates);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const endError = parsed.error.issues.find((i) => i.path.includes('semester_end'));
      expect(endError?.message).toContain('Semester end date must be strictly after start date');
    }
  });

  it('should reject overlapping period times', () => {
    const overlappingPeriods = {
      ...validBaseRules,
      periods: [
        { period: 1, start: '09:00', end: '10:00' },
        { period: 2, start: '09:45', end: '10:45' }, // Overlaps with period 1
        { period: 3, start: '11:00', end: '11:50' },
      ],
    };

    const parsed = RulesFormSchema.safeParse(overlappingPeriods);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const overlapError = parsed.error.issues.find((i) => i.message.includes('overlaps with'));
      expect(overlapError).toBeDefined();
    }
  });

  it('should reject when period end time is not strictly after start time', () => {
    const invertedPeriod = {
      ...validBaseRules,
      periods: [
        { period: 1, start: '10:00', end: '09:00' }, // end before start
        { period: 2, start: '10:15', end: '11:00' },
        { period: 3, start: '11:15', end: '12:00' },
      ],
    };

    const parsed = RulesFormSchema.safeParse(invertedPeriod);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const err = parsed.error.issues.find((i) => i.message.includes('must be after start time'));
      expect(err).toBeDefined();
    }
  });

  it('should reject invalid section limits (min > default or default > max)', () => {
    // Case 1: min > default
    const minExceedsDefault = {
      ...validBaseRules,
      min_section_size: 65,
      default_section_size: 60,
      max_section_size: 70,
    };
    const parsed1 = RulesFormSchema.safeParse(minExceedsDefault);
    expect(parsed1.success).toBe(false);
    if (!parsed1.success) {
      expect(parsed1.error.issues.some((i) => i.message.includes('Minimum section size cannot exceed'))).toBe(true);
    }

    // Case 2: default > max
    const defaultExceedsMax = {
      ...validBaseRules,
      min_section_size: 30,
      default_section_size: 75,
      max_section_size: 70,
    };
    const parsed2 = RulesFormSchema.safeParse(defaultExceedsMax);
    expect(parsed2.success).toBe(false);
    if (!parsed2.success) {
      expect(parsed2.error.issues.some((i) => i.message.includes('Default section size cannot exceed'))).toBe(true);
    }
  });

  it('should reject when number of period slots does not match periods_per_day', () => {
    const mismatch = {
      ...validBaseRules,
      periods_per_day: 5,
      periods: [
        { period: 1, start: '09:00', end: '09:50' },
        { period: 2, start: '10:00', end: '10:50' },
      ],
    };

    const parsed = RulesFormSchema.safeParse(mismatch);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('Expected 5 period slots, but received 2'))).toBe(true);
    }
  });
});
