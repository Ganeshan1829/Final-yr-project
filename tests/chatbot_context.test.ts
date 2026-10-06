import { describe, it, expect } from 'vitest';
import { buildDateTable, buildStaffHint, findStaffByName, normalizeStaffArgs } from '../server/src/services/chatbot/queryContext';

const STAFF = [
  { staff_id: 'STF001', staff_name: 'Dr. Rajesh Sharma' },
  { staff_id: 'STF011', staff_name: 'Prof. Karthik Venkatesh' },
  { staff_id: 'STF007', staff_name: 'Prof. Vikram Menon' },
  { staff_id: 'STF012', staff_name: 'Dr. Anita Kumar' },
  { staff_id: 'STF013', staff_name: 'Mr. Suresh Kumar' },
];

describe('relative date table', () => {
  // Tuesday 2026-10-06
  const table = buildDateTable(new Date(2026, 9, 6));
  it('resolves today/tomorrow', () => {
    expect(table).toContain('today = 2026-10-06 (Tuesday)');
    expect(table).toContain('tomorrow = 2026-10-07');
  });
  it('resolves this/next week as Monday-Friday', () => {
    expect(table).toContain('this week = 2026-10-05 to 2026-10-09');
    expect(table).toContain('next week = 2026-10-12 to 2026-10-16');
  });
  it('resolves upcoming weekdays strictly after today', () => {
    expect(table).toContain('Tuesday = 2026-10-13');
    expect(table).toContain('Friday = 2026-10-09');
  });
  it('handles a Sunday (week still starts Monday)', () => {
    const sunday = buildDateTable(new Date(2026, 9, 4));
    expect(sunday).toContain('this week = 2026-09-28 to 2026-10-02');
    expect(sunday).toContain('next week = 2026-10-05 to 2026-10-09');
  });
});

describe('staff name lookup', () => {
  it('matches a first name with a title', () => {
    expect(findStaffByName('Is Prof Karthik free tomorrow?', STAFF).map((s) => s.staff_id)).toEqual(['STF011']);
  });
  it('matches a surname, case-insensitive', () => {
    expect(findStaffByName('timetable for SHARMA', STAFF).map((s) => s.staff_id)).toEqual(['STF001']);
  });
  it('prefers the fuller name match', () => {
    expect(findStaffByName('Suresh Kumar leave', STAFF).map((s) => s.staff_id)).toEqual(['STF013']);
  });
  it('reports ambiguity for a shared surname', () => {
    expect(findStaffByName('is kumar free', STAFF)).toHaveLength(2);
    expect(buildStaffHint('is kumar free', STAFF)).toContain('Ask which one');
  });
  it('ignores titles and short words', () => {
    expect(findStaffByName('is the prof free', STAFF)).toEqual([]);
  });
  it('builds a resolved hint and skips explicit IDs', () => {
    expect(buildStaffHint('Is Karthik free?', STAFF)).toContain('STF011');
    expect(buildStaffHint('Is STF011 Karthik free?', STAFF)).toBe('');
  });
});

describe('normalizeStaffArgs', () => {
  it('replaces a name in a staff_id field', () => {
    expect(normalizeStaffArgs({ staff_id: 'Prof Karthik', date: '2026-08-04' }, STAFF)).toEqual({ staff_id: 'STF011', date: '2026-08-04' });
  });
  it('fixes arrays and nested payloads, uppercases IDs', () => {
    const out: any = normalizeStaffArgs({ unavailable_staff_ids: ['stf001', 'Vikram'], payload: { staff_id: 'Rajesh' } }, STAFF);
    expect(out.unavailable_staff_ids).toEqual(['STF001', 'STF007']);
    expect(out.payload.staff_id).toBe('STF001');
  });
  it('leaves ambiguous or unknown names untouched', () => {
    expect(normalizeStaffArgs({ staff_id: 'Kumar' }, STAFF)).toEqual({ staff_id: 'Kumar' });
    expect(normalizeStaffArgs({ staff_id: 'Nobody' }, STAFF)).toEqual({ staff_id: 'Nobody' });
  });
});
