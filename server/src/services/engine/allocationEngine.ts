/**
 * Deterministic, constraint-aware student-to-teacher allocation (pure functions, no DB access).
 *
 * Inputs may include ML recommendations (`ml_expected`) and teacher preferences (`preferred`),
 * but the HARD limits (teacher max, room capacity, remaining teaching hours) are always enforced here.
 * ML / feedback only steer the SOFT targets.
 *
 * Order of decisions for one subject:
 *   1. Honour student choices up to each teacher's hard cap (overflow goes to the pool).
 *   2. Pick the smallest sensible set of teachers able to absorb the pool.
 *   3. Fill each teacher up to their soft target (ML recommendation, else preferred size) proportionally to the gap.
 *   4. Fill remaining students up to the hard caps proportionally to remaining headroom.
 *   5. Students still unplaced open EXTRA BATCHES (second/third section) for teachers with weekly hours left.
 *   6. Anything still unplaced is reported as a shortfall (never silently dropped).
 */

export interface TeacherCandidate {
  staff_id: string;
  /** Soft target: preferred class size (from feedback/history/default). */
  preferred: number;
  /** Hard cap on students (already includes any admin override). */
  max: number;
  /** Teaching hours still available this week. */
  hours_remaining: number;
  /** Hours already assigned in earlier subjects (used for workload balancing only). */
  assigned_hours: number;
  /** ML recommended class size for this subject, if available. Advisory only. */
  ml_expected: number | null;
  /** Students who explicitly chose this teacher, in selection order. */
  chosen_ids: string[];
}

export interface AllocationRequest {
  subject_code: string;
  hours_per_week: number;
  /** Largest room that can host the subject (hard cap for every teacher). */
  room_capacity: number;
  min_section_size: number;
  /** Students who did not choose a teacher (or whose chosen teacher is not qualified). */
  unassigned_ids: string[];
  teachers: TeacherCandidate[];
}

export interface TeacherAllocation {
  staff_id: string;
  student_ids: string[];
  basis: {
    demand_total: number;
    chosen: number;
    moved_in: number;
    moved_out: number;
    preferred: number;
    max_effective: number;
    ml_expected: number | null;
    soft_target: number;
    hard_cap: number;
    rule: 'student_choice' | 'demand_fill' | 'extra_batch';
  };
}

export interface AllocationResult {
  allocations: TeacherAllocation[];
  /** Students that could not be placed without breaking a hard cap. */
  unallocated_ids: string[];
  warnings: string[];
}

/** Largest-remainder proportional split of `amount` by `gaps`, never exceeding a gap. */
function proportionalSplit(amount: number, gaps: Array<[string, number]>): { shares: Map<string, number>; rest: number } {
  const shares = new Map<string, number>();
  const total = gaps.reduce((a, [, g]) => a + g, 0);
  if (total <= 0 || amount <= 0) {
    for (const [id] of gaps) shares.set(id, 0);
    return { shares, rest: Math.max(0, amount) };
  }
  if (amount >= total) {
    for (const [id, g] of gaps) shares.set(id, g);
    return { shares, rest: amount - total };
  }
  const parts = gaps.map(([id, g]) => {
    const exact = (amount * g) / total;
    return { id, base: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = amount - parts.reduce((a, p) => a + p.base, 0);
  const order = [...parts].sort((a, b) => b.frac - a.frac || a.id.localeCompare(b.id));
  for (const p of order) {
    if (left <= 0) break;
    if (p.frac > 0) {
      p.base += 1;
      left -= 1;
    }
  }
  for (const p of parts) shares.set(p.id, p.base);
  return { shares, rest: 0 };
}

interface Plan {
  kept: Map<string, string[]>;
  extra: Map<string, number>;
  leftover: number;
}

function plan(
  subset: TeacherCandidate[],
  kept: Map<string, string[]>,
  pool: number,
  cap: Map<string, number>,
  target: Map<string, number>
): Plan {
  const extra = new Map<string, number>(subset.map((t) => [t.staff_id, 0]));
  let remaining = pool;

  // Stage 1: up to soft target
  const gap1: Array<[string, number]> = subset.map((t) => {
    const load = kept.get(t.staff_id)!.length;
    const tgt = Math.min(cap.get(t.staff_id)!, target.get(t.staff_id)!);
    return [t.staff_id, Math.max(0, tgt - load)];
  });
  const s1 = proportionalSplit(remaining, gap1);
  for (const [id, n] of s1.shares) extra.set(id, (extra.get(id) || 0) + n);
  remaining = s1.rest;

  // Stage 2: up to hard cap
  if (remaining > 0) {
    const gap2: Array<[string, number]> = subset.map((t) => {
      const load = kept.get(t.staff_id)!.length + (extra.get(t.staff_id) || 0);
      return [t.staff_id, Math.max(0, cap.get(t.staff_id)! - load)];
    });
    const s2 = proportionalSplit(remaining, gap2);
    for (const [id, n] of s2.shares) extra.set(id, (extra.get(id) || 0) + n);
    remaining = s2.rest;
  }
  return { kept, extra, leftover: remaining };
}

export function allocateStudents(req: AllocationRequest): AllocationResult {
  const warnings: string[] = [];
  const teachers = [...req.teachers].sort((a, b) => a.staff_id.localeCompare(b.staff_id));

  const cap = new Map<string, number>();
  for (const t of teachers) {
    const hoursOk = t.hours_remaining >= req.hours_per_week;
    cap.set(t.staff_id, hoursOk ? Math.max(0, Math.min(t.max, req.room_capacity)) : 0);
  }

  // 1. Honour choices up to hard cap
  const kept = new Map<string, string[]>();
  const movedOut = new Map<string, number>();
  const pool: string[] = [...req.unassigned_ids];
  for (const t of teachers) {
    const c = cap.get(t.staff_id)!;
    const keep = t.chosen_ids.slice(0, c);
    const spill = t.chosen_ids.slice(c);
    kept.set(t.staff_id, keep);
    movedOut.set(t.staff_id, spill.length);
    if (spill.length > 0) {
      pool.push(...spill);
      warnings.push(
        `${req.subject_code}: ${spill.length} student(s) who chose ${t.staff_id} exceed that teacher's hard limit (${c}) and were redistributed.`
      );
    }
  }

  const totalDemand = pool.length + [...kept.values()].reduce((a, l) => a + l.length, 0);

  // soft target = ML recommendation if present, else preferred
  const target = new Map<string, number>();
  for (const t of teachers) {
    const base = t.ml_expected != null && t.ml_expected > 0 ? Math.round(t.ml_expected) : t.preferred;
    target.set(t.staff_id, Math.max(1, base));
  }

  // 2. Candidate subset: forced (have kept students) + minimal extra teachers by workload
  const forced = teachers.filter((t) => kept.get(t.staff_id)!.length > 0);
  const optional = teachers
    .filter((t) => kept.get(t.staff_id)!.length === 0 && cap.get(t.staff_id)! > 0)
    .sort(
      (a, b) =>
        a.assigned_hours - b.assigned_hours ||
        (b.ml_expected ?? b.preferred) - (a.ml_expected ?? a.preferred) ||
        a.staff_id.localeCompare(b.staff_id)
    );

  const softRoom = (set: TeacherCandidate[]) =>
    set.reduce((a, t) => a + Math.max(0, Math.min(cap.get(t.staff_id)!, target.get(t.staff_id)!) - kept.get(t.staff_id)!.length), 0);
  const hardRoom = (set: TeacherCandidate[]) =>
    set.reduce((a, t) => a + Math.max(0, cap.get(t.staff_id)! - kept.get(t.staff_id)!.length), 0);

  let subset = [...forced];
  const optQueue = [...optional];
  while (pool.length > 0 && softRoom(subset) < pool.length && optQueue.length > 0) subset.push(optQueue.shift()!);
  while (pool.length > 0 && hardRoom(subset) < pool.length && optQueue.length > 0) subset.push(optQueue.shift()!);

  let result = plan(subset, kept, pool.length, cap, target);

  // Avoid needlessly tiny sections: drop the smallest optional teacher if the rest can still absorb the pool
  for (;;) {
    const optionalInSubset = subset.filter((t) => kept.get(t.staff_id)!.length === 0);
    if (optionalInSubset.length === 0 || pool.length === 0) break;
    const sized = optionalInSubset
      .map((t) => ({ t, n: result.extra.get(t.staff_id) || 0 }))
      .sort((a, b) => a.n - b.n || b.t.staff_id.localeCompare(a.t.staff_id));
    const smallest = sized[0];
    if (smallest.n >= req.min_section_size && smallest.n > 0) break;
    const reduced = subset.filter((t) => t.staff_id !== smallest.t.staff_id);
    if (reduced.length === 0 || hardRoom(reduced) < pool.length) break;
    const trial = plan(reduced, kept, pool.length, cap, target);
    if (trial.leftover > 0) break;
    subset = reduced;
    result = trial;
  }

  // 3. Materialise student lists
  let cursor = 0;
  const allocations: TeacherAllocation[] = [];
  for (const t of teachers) {
    const mine = kept.get(t.staff_id)!;
    const n = result.extra.get(t.staff_id) || 0;
    const added = pool.slice(cursor, cursor + n);
    cursor += n;
    const ids = [...mine, ...added];
    if (ids.length === 0) continue;
    allocations.push({
      staff_id: t.staff_id,
      student_ids: ids,
      basis: {
        demand_total: totalDemand,
        chosen: t.chosen_ids.length,
        moved_in: added.length,
        moved_out: movedOut.get(t.staff_id) || 0,
        preferred: t.preferred,
        max_effective: t.max,
        ml_expected: t.ml_expected,
        soft_target: target.get(t.staff_id)!,
        hard_cap: cap.get(t.staff_id)!,
        rule: t.chosen_ids.length > 0 && added.length === 0 ? 'student_choice' : 'demand_fill',
      },
    });
  }

  let leftover = pool.slice(cursor);

  // 5. Extra batches: a teacher may run additional sections of the same subject while weekly hours remain.
  if (leftover.length > 0) {
    const used = new Map<string, number>(allocations.map((a) => [a.staff_id, a.student_ids.length > 0 ? 1 : 0]));
    for (let guard = 0; leftover.length > 0 && guard < 50; guard++) {
      const open = teachers
        .map((t) => {
          const slots = req.hours_per_week > 0 ? Math.floor(t.hours_remaining / req.hours_per_week) : 0;
          return { t, free: slots - (used.get(t.staff_id) || 0), c: cap.get(t.staff_id)! };
        })
        .filter((o) => o.free > 0 && o.c > 0)
        .sort(
          (a, b) =>
            a.t.assigned_hours + (used.get(a.t.staff_id) || 0) * req.hours_per_week -
              (b.t.assigned_hours + (used.get(b.t.staff_id) || 0) * req.hours_per_week) ||
            a.t.staff_id.localeCompare(b.t.staff_id)
        );
      if (open.length === 0) break;
      // open just enough batches (least-loaded teachers first) to absorb the leftovers
      const chosen: typeof open = [];
      let room = 0;
      for (const o of open) {
        chosen.push(o);
        room += o.c;
        if (room >= leftover.length) break;
      }
      const split = proportionalSplit(leftover.length, chosen.map((o) => [o.t.staff_id, o.c] as [string, number]));
      let at = 0;
      for (const o of chosen) {
        const n = split.shares.get(o.t.staff_id) || 0;
        if (n <= 0) continue;
        used.set(o.t.staff_id, (used.get(o.t.staff_id) || 0) + 1);
        allocations.push({
          staff_id: o.t.staff_id,
          student_ids: leftover.slice(at, at + n),
          basis: {
            demand_total: totalDemand,
            chosen: 0,
            moved_in: n,
            moved_out: 0,
            preferred: o.t.preferred,
            max_effective: o.t.max,
            ml_expected: o.t.ml_expected,
            soft_target: target.get(o.t.staff_id)!,
            hard_cap: o.c,
            rule: 'extra_batch',
          },
        });
        at += n;
      }
      leftover = leftover.slice(at);
      if (at === 0) break;
    }
  }

  return { allocations, unallocated_ids: leftover, warnings };
}
