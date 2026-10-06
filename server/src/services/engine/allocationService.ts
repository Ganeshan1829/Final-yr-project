import { db } from '../../db.js';
import { allocateStudents, AllocationResult, TeacherCandidate } from './allocationEngine.js';

export interface TeacherProfile {
  staff_id: string;
  preferred: number;
  max: number;
  /** where `preferred` came from, for explainability */
  preferred_source: 'subject_preference' | 'teacher_preference' | 'history' | 'default';
  admin_override: boolean;
}

export interface AllocationDefaults {
  /** rules.default_section_size */
  default_size: number;
  /** rules.max_section_size (hard, unless the teacher has an admin override) */
  rules_max: number;
}

function tableHasRows(table: string): boolean {
  try {
    const row = db.prepare(`SELECT 1 AS x FROM ${table} LIMIT 1`).get();
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Resolves a teacher's soft/hard class-size limits for a subject.
 * Precedence for `preferred`: subject preference > teacher-wide preference > historical average > default.
 * `max` is a hard cap: preference max (bounded by rules max), or the admin override when explicitly set.
 */
export function resolveTeacherProfile(staffId: string, subjectCode: string, defaults: AllocationDefaults): TeacherProfile {
  const prefStmt = db.prepare(
    `SELECT * FROM teacher_preferences WHERE staff_id = ? AND subject_code IN (?, '*') ORDER BY CASE subject_code WHEN '*' THEN 1 ELSE 0 END`
  );
  const prefs = prefStmt.all(staffId, subjectCode) as any[];
  const subjectPref = prefs.find((p) => p.subject_code === subjectCode);
  const generalPref = prefs.find((p) => p.subject_code === '*');
  const override: number | null =
    subjectPref?.admin_override_max ?? generalPref?.admin_override_max ?? null;

  let preferred: number | null = null;
  let source: TeacherProfile['preferred_source'] = 'default';
  if (subjectPref?.preferred_class_size) {
    preferred = subjectPref.preferred_class_size;
    source = 'subject_preference';
  } else if (generalPref?.preferred_class_size) {
    preferred = generalPref.preferred_class_size;
    source = 'teacher_preference';
  } else {
    const hist = db
      .prepare(
        `SELECT AVG(class_size) AS avg_size FROM (
           SELECT class_size FROM historical_allocations WHERE staff_id = ? AND subject_code = ?
           UNION ALL
           SELECT class_size FROM teacher_feedback WHERE staff_id = ? AND subject_code = ? AND overcrowded = 0
         )`
      )
      .get(staffId, subjectCode, staffId, subjectCode) as any;
    if (hist?.avg_size) {
      preferred = Math.round(hist.avg_size);
      source = 'history';
    }
  }

  const prefMax: number | null = subjectPref?.max_class_size ?? generalPref?.max_class_size ?? null;
  let max = override ?? Math.min(prefMax ?? defaults.rules_max, defaults.rules_max);
  max = Math.max(1, max);
  const pref = Math.min(preferred ?? Math.min(defaults.default_size, max), max);

  return { staff_id: staffId, preferred: pref, max, preferred_source: source, admin_override: override != null };
}

/** Latest ML recommendation per (subject, staff). Empty when no prediction batch has been stored. */
export function loadLatestPredictions(): Map<string, number> {
  const map = new Map<string, number>();
  if (!tableHasRows('class_predictions')) return map;
  const rows = db
    .prepare(`SELECT subject_code, staff_id, predicted_students FROM class_predictions ORDER BY id ASC`)
    .all() as any[];
  for (const r of rows) map.set(`${r.subject_code}|${r.staff_id}`, r.predicted_students);
  return map;
}

export interface SubjectAllocationInput {
  subject_code: string;
  hours_per_week: number;
  room_capacity: number;
  min_section_size: number;
  qualified_staff: string[];
  /** students with an explicit teacher choice, in selection order */
  choices: Array<{ student_id: string; staff_id?: string }>;
  /** students without any choice */
  floating_ids: string[];
  staff_hours: Map<string, { max_hours: number; committed: number; assigned: number }>;
  defaults: AllocationDefaults;
  predictions: Map<string, number>;
  /** staff that must not receive students (e.g. on leave in what-if simulations) */
  excluded_staff?: Set<string>;
}

export interface SubjectAllocationOutput extends AllocationResult {
  profiles: Map<string, TeacherProfile>;
}

export function allocateSubject(input: SubjectAllocationInput): SubjectAllocationOutput {
  const profiles = new Map<string, TeacherProfile>();
  const chosenBy = new Map<string, string[]>();
  const unassigned: string[] = [...input.floating_ids];

  const eligible = input.qualified_staff.filter((s) => !input.excluded_staff?.has(s));
  for (const s of eligible) chosenBy.set(s, []);
  for (const c of input.choices) {
    if (c.staff_id && chosenBy.has(c.staff_id)) chosenBy.get(c.staff_id)!.push(c.student_id);
    else unassigned.push(c.student_id);
  }

  const teachers: TeacherCandidate[] = eligible.map((staffId) => {
    const profile = resolveTeacherProfile(staffId, input.subject_code, input.defaults);
    profiles.set(staffId, profile);
    const h = input.staff_hours.get(staffId);
    const remaining = h ? (h.max_hours || 20) - (h.committed || 0) - h.assigned : 0;
    return {
      staff_id: staffId,
      preferred: profile.preferred,
      max: profile.max,
      hours_remaining: remaining,
      assigned_hours: h?.assigned ?? 0,
      ml_expected: input.predictions.get(`${input.subject_code}|${staffId}`) ?? null,
      chosen_ids: chosenBy.get(staffId)!,
    };
  });

  const result = allocateStudents({
    subject_code: input.subject_code,
    hours_per_week: input.hours_per_week,
    room_capacity: input.room_capacity,
    min_section_size: input.min_section_size,
    unassigned_ids: unassigned,
    teachers,
  });
  return { ...result, profiles };
}
