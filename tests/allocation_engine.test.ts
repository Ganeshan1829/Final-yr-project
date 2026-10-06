import { describe, it, expect } from 'vitest';
import { allocateStudents, TeacherCandidate } from '../server/src/services/engine/allocationEngine.js';

const ids = (n: number, p = 'S') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const T = (staff_id: string, preferred: number, max: number, extra: Partial<TeacherCandidate> = {}): TeacherCandidate => ({
  staff_id,
  preferred,
  max,
  hours_remaining: 20,
  assigned_hours: 0,
  ml_expected: null,
  chosen_ids: [],
  ...extra,
});
const sizes = (r: ReturnType<typeof allocateStudents>) => Object.fromEntries(r.allocations.map((a) => [a.staff_id, a.student_ids.length]));
const base = { subject_code: 'X', hours_per_week: 3, room_capacity: 80, min_section_size: 10 };

describe('Teacher-aware allocation engine', () => {
  it('does not force equal sizes: 60 students, preferred 30/20, max 40/30', () => {
    const r = allocateStudents({ ...base, unassigned_ids: ids(60), teachers: [T('A', 30, 40), T('B', 20, 30)] });
    const s = sizes(r);
    expect(s.A + s.B).toBe(60);
    expect(s.A).toBeGreaterThan(s.B);
    expect(s.A).toBeLessThanOrEqual(40);
    expect(s.B).toBeLessThanOrEqual(30);
    expect(r.unallocated_ids).toEqual([]);
  });

  it('ML recommendation 40/20 steers the split, but is advisory', () => {
    const r = allocateStudents({
      ...base,
      unassigned_ids: ids(60),
      teachers: [T('A', 30, 40, { ml_expected: 40 }), T('B', 20, 30, { ml_expected: 20 })],
    });
    expect(sizes(r)).toEqual({ A: 40, B: 20 });
  });

  it('ML can never exceed the hard max', () => {
    const r = allocateStudents({
      ...base,
      unassigned_ids: ids(60),
      teachers: [T('A', 30, 40, { ml_expected: 55 }), T('B', 20, 30, { ml_expected: 5 })],
    });
    const s = sizes(r);
    expect(s.A).toBeLessThanOrEqual(40);
    expect(s.A + s.B).toBe(60);
  });

  it('90 students / three teachers respects each max and is not 30/30/30 by rule', () => {
    const r = allocateStudents({ ...base, unassigned_ids: ids(90), teachers: [T('A', 30, 40), T('B', 25, 35), T('C', 30, 40)] });
    const s = sizes(r);
    expect(s.A + s.B + s.C).toBe(90);
    expect(s.A).toBeLessThanOrEqual(40);
    expect(s.B).toBeLessThanOrEqual(35);
    expect(s.C).toBeLessThanOrEqual(40);
    expect(s.B).toBeLessThan(s.A);
  });

  it('adapts when a teacher has no remaining hours', () => {
    const r = allocateStudents({
      ...base,
      unassigned_ids: ids(60),
      teachers: [T('A', 30, 40), T('B', 25, 35, { hours_remaining: 1 }), T('C', 30, 40)],
    });
    const s = sizes(r);
    expect(s.B).toBeUndefined();
    expect(s.A + s.C).toBe(60);
  });

  it('room capacity is a hard cap; extra batches use spare hours', () => {
    const r = allocateStudents({ ...base, room_capacity: 25, unassigned_ids: ids(60), teachers: [T('A', 30, 40), T('B', 30, 40)] });
    expect(r.allocations.every((a) => a.student_ids.length <= 25)).toBe(true);
    expect(r.allocations.reduce((n, a) => n + a.student_ids.length, 0)).toBe(60);
    expect(r.unallocated_ids).toEqual([]);
  });

  it('reports shortfall (never drops students) when no hours remain for extra batches', () => {
    const r = allocateStudents({
      ...base,
      room_capacity: 25,
      unassigned_ids: ids(60),
      teachers: [T('A', 30, 40, { hours_remaining: 3 }), T('B', 30, 40, { hours_remaining: 3 })],
    });
    expect(r.allocations.every((a) => a.student_ids.length <= 25)).toBe(true);
    expect(r.unallocated_ids.length).toBe(10);
  });

  it('keeps student choices, spilling only above the hard cap', () => {
    const r = allocateStudents({
      ...base,
      unassigned_ids: [],
      teachers: [T('A', 30, 40, { chosen_ids: ids(50, 'a') }), T('B', 30, 40, { chosen_ids: ids(10, 'b') })],
    });
    const s = sizes(r);
    expect(s.A).toBe(40);
    expect(s.B).toBe(20);
    expect(r.warnings.length).toBe(1);
  });

  it('avoids creating a tiny extra section when one teacher can absorb the students', () => {
    const r = allocateStudents({ ...base, min_section_size: 20, unassigned_ids: ids(35), teachers: [T('A', 30, 40), T('B', 30, 40)] });
    expect(r.allocations.length).toBe(1);
    expect(r.allocations[0].student_ids.length).toBe(35);
  });

  it('is deterministic', () => {
    const run = () => sizes(allocateStudents({ ...base, unassigned_ids: ids(77), teachers: [T('A', 30, 40), T('B', 25, 35), T('C', 20, 30)] }));
    expect(run()).toEqual(run());
  });
});
