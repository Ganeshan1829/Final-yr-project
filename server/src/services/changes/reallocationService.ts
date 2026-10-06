import { db } from '../../db.js';
import { allocateStudents, TeacherCandidate } from '../engine/allocationEngine.js';
import { loadLatestPredictions, resolveTeacherProfile } from '../engine/allocationService.js';
import { getAllocationDefaults } from '../engine/demandPredictionService.js';

/**
 * Teacher/student reallocation (what-if + confirmable change).
 *
 * Scope: students of sections whose teacher is unavailable are moved to OTHER EXISTING sections of the same
 * subject. Those sections already own a clash-free weekly timetable and a room, so no room/teacher clash can be
 * introduced; what is verified here is class size (teacher hard max, room capacity) and student schedule clashes.
 * The decision is made by the deterministic allocation engine; ML predictions (stored by the backend) only steer
 * the soft per-teacher targets. Nothing is written until the HOD confirms the staged change.
 */

export interface ReallocationPayload {
  unavailable_staff_ids: string[];
  subject_codes?: string[];
  /** Used to also treat teachers on approved leave on this date as unavailable. */
  effective_date?: string;
  reason?: string;
}

export type UnresolvedCause = 'schedule_clash' | 'capacity' | 'no_section';

export interface StudentMove {
  student_id: string;
  subject_code: string;
  from_section_id: number;
  to_section_id: number;
  to_staff_id: string;
}

export interface SectionOutcome {
  section_id: number;
  section_label: string | null;
  staff_id: string;
  staff_name: string | null;
  role: 'source' | 'target';
  before: number;
  after: number;
  preferred: number | null;
  hard_cap: number | null;
  ml_expected: number | null;
}

export interface ReallocationPlan {
  unavailable_staff_ids: string[];
  subjects: Array<{
    subject_code: string;
    subject_name: string;
    displaced: number;
    placed: number;
    unresolved: number;
    sections: SectionOutcome[];
  }>;
  moves: StudentMove[];
  /** cause: 'schedule_clash' = other sections have room but the student has another class at that time;
   *  'capacity' = no other section has room within teacher/room limits; 'no_section' = nobody else teaches the subject. */
  unresolved: Array<{ student_id: string; subject_code: string; section_id: number; reason: string; cause: UnresolvedCause }>;
  warnings: string[];
  ml_used: boolean;
}

interface SectionRow {
  section_id: number;
  subject_code: string;
  staff_id: string;
  section_label: string | null;
  size: number;
}

function sectionRoomCapacity(sectionId: number, fallback: number): number {
  const row = db
    .prepare(
      `SELECT MIN(r.capacity) AS cap FROM timetable_slots ts JOIN rooms r ON r.room_id = ts.room_id WHERE ts.section_id = ?`
    )
    .get(sectionId) as any;
  return row?.cap ?? fallback;
}

function sectionSlotKeys(sectionId: number): Set<string> {
  const rows = db.prepare(`SELECT day_of_week, period FROM timetable_slots WHERE section_id = ?`).all(sectionId) as any[];
  return new Set(rows.map((r) => `${r.day_of_week}-${r.period}`));
}

function studentSlotKeys(studentId: string, excludeSectionId: number): Set<string> {
  const rows = db
    .prepare(
      `SELECT ts.day_of_week, ts.period FROM section_students ss
       JOIN timetable_slots ts ON ts.section_id = ss.section_id
       WHERE ss.student_id = ? AND ss.section_id != ?`
    )
    .all(studentId, excludeSectionId) as any[];
  return new Set(rows.map((r) => `${r.day_of_week}-${r.period}`));
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const k of a) if (b.has(k)) return true;
  return false;
}

export function planReallocation(payload: ReallocationPayload): ReallocationPlan {
  const defaults = getAllocationDefaults();
  const predictions = loadLatestPredictions();
  const warnings: string[] = [];

  const unavailable = new Set(payload.unavailable_staff_ids);
  if (payload.effective_date) {
    const onLeave = db
      .prepare(`SELECT DISTINCT staff_id FROM leave WHERE status = 'approved' AND date_from <= ? AND date_to >= ?`)
      .all(payload.effective_date, payload.effective_date) as any[];
    for (const r of onLeave) unavailable.add(r.staff_id);
  }

  const staffRows = db.prepare(`SELECT staff_id, staff_name FROM staff`).all() as any[];
  const staffName = new Map<string, string>(staffRows.map((s) => [s.staff_id, s.staff_name]));
  const subjectName = new Map<string, string>(
    (db.prepare(`SELECT subject_code, subject_name FROM subjects`).all() as any[]).map((s) => [s.subject_code, s.subject_name])
  );

  const allSections = db
    .prepare(`SELECT section_id, subject_code, staff_id, section_label, size FROM sections ORDER BY subject_code, section_id`)
    .all() as unknown as SectionRow[];
  const sourceSections = allSections.filter(
    (s) => unavailable.has(s.staff_id) && (!payload.subject_codes?.length || payload.subject_codes.includes(s.subject_code))
  );

  const moves: StudentMove[] = [];
  const unresolved: ReallocationPlan['unresolved'] = [];
  const subjectsOut: ReallocationPlan['subjects'] = [];
  const mlUsed = predictions.size > 0;

  const memberStmt = db.prepare(`SELECT student_id FROM section_students WHERE section_id = ? ORDER BY student_id`);
  const subjectCodes = [...new Set(sourceSections.map((s) => s.subject_code))];

  for (const code of subjectCodes) {
    const sources = sourceSections.filter((s) => s.subject_code === code);
    const targets = allSections.filter((s) => s.subject_code === code && !unavailable.has(s.staff_id));

    const displacedBySection = new Map<number, string[]>();
    for (const src of sources) displacedBySection.set(src.section_id, (memberStmt.all(src.section_id) as any[]).map((r) => r.student_id));
    const displacedIds = [...displacedBySection.values()].flat();

    const outcomes: SectionOutcome[] = sources.map((s) => ({
      section_id: s.section_id,
      section_label: s.section_label,
      staff_id: s.staff_id,
      staff_name: staffName.get(s.staff_id) ?? null,
      role: 'source',
      before: displacedBySection.get(s.section_id)!.length,
      after: displacedBySection.get(s.section_id)!.length,
      preferred: null,
      hard_cap: null,
      ml_expected: null,
    }));

    if (displacedIds.length === 0) {
      subjectsOut.push({ subject_code: code, subject_name: subjectName.get(code) ?? code, displaced: 0, placed: 0, unresolved: 0, sections: outcomes });
      continue;
    }

    if (targets.length === 0) {
      warnings.push(`${code}: no other teacher has a section of this subject; ${displacedIds.length} student(s) cannot be reassigned without creating a new section (re-run the section splitter).`);
      for (const src of sources) {
        for (const stu of displacedBySection.get(src.section_id)!) {
          unresolved.push({ student_id: stu, subject_code: code, section_id: src.section_id, reason: 'No other teacher has a section of this subject.', cause: 'no_section' });
        }
      }
      subjectsOut.push({ subject_code: code, subject_name: subjectName.get(code) ?? code, displaced: displacedIds.length, placed: 0, unresolved: displacedIds.length, sections: outcomes });
      continue;
    }

    // Candidates are keyed by section_id so a teacher with two sections of one subject is handled correctly.
    const capBySection = new Map<number, number>();
    const memberBySection = new Map<number, string[]>();
    const profileBySection = new Map<number, ReturnType<typeof resolveTeacherProfile>>();
    const candidates: TeacherCandidate[] = targets.map((t) => {
      const profile = resolveTeacherProfile(t.staff_id, code, defaults);
      const roomCap = sectionRoomCapacity(t.section_id, defaults.rules_max);
      const members = (memberStmt.all(t.section_id) as any[]).map((r) => r.student_id);
      profileBySection.set(t.section_id, profile);
      memberBySection.set(t.section_id, members);
      capBySection.set(t.section_id, Math.min(profile.max, roomCap));
      return {
        staff_id: String(t.section_id),
        preferred: Math.min(profile.preferred, roomCap),
        max: Math.min(profile.max, roomCap),
        // exactly one batch per candidate: no new sections can be opened without re-solving the timetable
        hours_remaining: 1,
        assigned_hours: members.length,
        ml_expected: predictions.get(`${code}|${t.staff_id}`) ?? null,
        chosen_ids: members,
      };
    });

    const result = allocateStudents({
      subject_code: code,
      hours_per_week: 1,
      room_capacity: Math.max(...candidates.map((c) => c.max)),
      min_section_size: 1,
      unassigned_ids: displacedIds,
      teachers: candidates,
    });
    warnings.push(...result.warnings);

    // Which source section each displaced student came from
    const originOf = new Map<string, number>();
    for (const [sid, list] of displacedBySection) for (const stu of list) originOf.set(stu, sid);

    // Target sizes tracked as we place students (engine proposals are validated, never trusted blindly)
    const size = new Map<number, number>(targets.map((t) => [t.section_id, memberBySection.get(t.section_id)!.length]));
    const targetSlots = new Map<number, Set<string>>(targets.map((t) => [t.section_id, sectionSlotKeys(t.section_id)]));
    const proposedTarget = new Map<string, number>();
    for (const a of result.allocations) {
      const secId = Number(a.staff_id);
      for (const stu of a.student_ids) if (originOf.has(stu)) proposedTarget.set(stu, secId);
    }

    // Result of trying one target: placed, full (hard limit), or blocked by the student's own timetable.
    const tryPlace = (stu: string, secId: number): 'ok' | 'full' | 'clash' => {
      if ((size.get(secId) || 0) + 1 > capBySection.get(secId)!) return 'full';
      const from = originOf.get(stu)!;
      if (intersects(studentSlotKeys(stu, from), targetSlots.get(secId)!)) return 'clash';
      size.set(secId, (size.get(secId) || 0) + 1);
      moves.push({ student_id: stu, subject_code: code, from_section_id: from, to_section_id: secId, to_staff_id: targets.find((t) => t.section_id === secId)!.staff_id });
      return 'ok';
    };

    let placed = 0;
    let unresolvedCount = 0;
    for (const stu of displacedIds) {
      const preferredTarget = proposedTarget.get(stu);
      let sawClash = false;
      const first = preferredTarget != null ? tryPlace(stu, preferredTarget) : 'full';
      if (first === 'clash') sawClash = true;
      let ok = first === 'ok';
      if (!ok) {
        // Engine's pick clashes with the student's other classes (or filled up): try the remaining sections by headroom.
        const alternatives = targets
          .map((t) => t.section_id)
          .filter((id) => id !== preferredTarget)
          .sort((a, b) => capBySection.get(b)! - size.get(b)! - (capBySection.get(a)! - size.get(a)!) || a - b);
        for (const alt of alternatives) {
          const r = tryPlace(stu, alt);
          if (r === 'ok') {
            ok = true;
            break;
          }
          if (r === 'clash') sawClash = true;
        }
      }
      if (ok) placed++;
      else {
        unresolvedCount++;
        unresolved.push({
          student_id: stu,
          subject_code: code,
          section_id: originOf.get(stu)!,
          reason: sawClash
            ? 'Other sections have room, but each meets at a time when this student already has another class.'
            : 'Every other section is at its room capacity or teacher maximum.',
          cause: sawClash ? 'schedule_clash' : 'capacity',
        });
      }
    }

    // Outcomes
    const placedFrom = new Map<number, number>();
    for (const m of moves.filter((m) => m.subject_code === code)) placedFrom.set(m.from_section_id, (placedFrom.get(m.from_section_id) || 0) + 1);
    for (const o of outcomes) o.after = o.before - (placedFrom.get(o.section_id) || 0);
    for (const t of targets) {
      const prof = profileBySection.get(t.section_id)!;
      outcomes.push({
        section_id: t.section_id,
        section_label: t.section_label,
        staff_id: t.staff_id,
        staff_name: staffName.get(t.staff_id) ?? null,
        role: 'target',
        before: memberBySection.get(t.section_id)!.length,
        after: size.get(t.section_id)!,
        preferred: prof.preferred,
        hard_cap: capBySection.get(t.section_id)!,
        ml_expected: predictions.get(`${code}|${t.staff_id}`) ?? null,
      });
    }
    subjectsOut.push({
      subject_code: code,
      subject_name: subjectName.get(code) ?? code,
      displaced: displacedIds.length,
      placed,
      unresolved: unresolvedCount,
      sections: outcomes,
    });
  }

  const byCause = (c: UnresolvedCause) => unresolved.filter((u) => u.cause === c).length;
  if (byCause('schedule_clash') > 0) {
    warnings.push(
      `${byCause('schedule_clash')} student(s) cannot move because every other section of their subject meets while they already have another class. Moving whole cohorts between existing sections rarely works for this reason; use a substitute teacher for the affected section (Faculty Leave tab) or re-run the section splitter and solver without the unavailable teacher.`
    );
  }
  if (byCause('capacity') > 0) {
    warnings.push(
      `${byCause('capacity')} student(s) cannot move because the other sections are at their room capacity or teacher maximum. Options for the HOD: approve a higher maximum for a teacher (admin override) or move a section to a larger room. Nothing is exceeded automatically.`
    );
  }

  if (sourceSections.length === 0) warnings.push('No sections are taught by the unavailable teacher(s); nothing to redistribute.');

  return { unavailable_staff_ids: [...unavailable], subjects: subjectsOut, moves, unresolved, warnings, ml_used: mlUsed };
}

/** Human-readable diff rows for the shared change-preview UI. */
export function reallocationDiff(plan: ReallocationPlan): Array<{ description: string; before: string; after: string }> {
  const rows: Array<{ description: string; before: string; after: string }> = [];
  for (const s of plan.subjects) {
    for (const o of s.sections) {
      if (o.before === o.after) continue;
      rows.push({
        description: `${s.subject_code} ${o.section_label ?? o.section_id} (${o.staff_name ?? o.staff_id}) - ${o.role === 'source' ? 'teacher unavailable' : 'receiving students'}`,
        before: `${o.before} students`,
        after: `${o.after} students${o.preferred != null ? ` (preferred ${o.preferred}, hard cap ${o.hard_cap})` : ''}`,
      });
    }
  }
  return rows;
}

/**
 * Applies a staged plan. Re-validates against current data so a preview made before other student movements
 * cannot overwrite them. Returns the before-state needed for revert.
 */
export function applyReallocation(moves: StudentMove[]): { before: StudentMove[]; touched_sections: number[] } {
  const touched = new Set<number>();
  const memberCheck = db.prepare(`SELECT 1 AS x FROM section_students WHERE section_id = ? AND student_id = ?`);
  for (const m of moves) {
    if (!memberCheck.get(m.from_section_id, m.student_id)) {
      throw new Error(`Preview is stale: student ${m.student_id} is no longer in section ${m.from_section_id}. Generate a fresh preview.`);
    }
    if (memberCheck.get(m.to_section_id, m.student_id)) {
      throw new Error(`Preview is stale: student ${m.student_id} is already in section ${m.to_section_id}. Generate a fresh preview.`);
    }
  }

  // Hard re-check of capacity before writing
  const incoming = new Map<number, number>();
  for (const m of moves) incoming.set(m.to_section_id, (incoming.get(m.to_section_id) || 0) + 1);
  const defaults = getAllocationDefaults();
  for (const [secId, n] of incoming) {
    const sec = db.prepare(`SELECT staff_id, subject_code FROM sections WHERE section_id = ?`).get(secId) as any;
    const current = (db.prepare(`SELECT COUNT(*) AS c FROM section_students WHERE section_id = ?`).get(secId) as any).c;
    const profile = resolveTeacherProfile(sec.staff_id, sec.subject_code, defaults);
    const cap = Math.min(profile.max, sectionRoomCapacity(secId, defaults.rules_max));
    if (current + n > cap) {
      throw new Error(`Section ${secId} would hold ${current + n} students, above its limit of ${cap}. Generate a fresh preview.`);
    }
  }

  const del = db.prepare(`DELETE FROM section_students WHERE section_id = ? AND student_id = ?`);
  const ins = db.prepare(`INSERT INTO section_students (section_id, student_id) VALUES (?, ?)`);
  for (const m of moves) {
    del.run(m.from_section_id, m.student_id);
    ins.run(m.to_section_id, m.student_id);
    touched.add(m.from_section_id);
    touched.add(m.to_section_id);
  }
  syncSectionSizes([...touched]);
  return { before: moves, touched_sections: [...touched] };
}

export function revertReallocation(moves: StudentMove[]): void {
  const touched = new Set<number>();
  const del = db.prepare(`DELETE FROM section_students WHERE section_id = ? AND student_id = ?`);
  const ins = db.prepare(`INSERT OR IGNORE INTO section_students (section_id, student_id) VALUES (?, ?)`);
  for (const m of moves) {
    del.run(m.to_section_id, m.student_id);
    ins.run(m.from_section_id, m.student_id);
    touched.add(m.from_section_id);
    touched.add(m.to_section_id);
  }
  syncSectionSizes([...touched]);
}

function syncSectionSizes(sectionIds: number[]): void {
  const upd = db.prepare(`UPDATE sections SET size = (SELECT COUNT(*) FROM section_students WHERE section_id = ?) WHERE section_id = ?`);
  for (const id of sectionIds) upd.run(id, id);
}
