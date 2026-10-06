import http from 'node:http';
import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
import { allocateSubject, loadLatestPredictions, resolveTeacherProfile, AllocationDefaults, TeacherProfile } from './allocationService.js';

/**
 * Bridge between the SQLite data and the advisory ML class-size model.
 * The ML service is pure (it never touches the DB); THIS module is the only writer of `class_predictions`,
 * and the stored numbers are only ever used as SOFT targets by the deterministic allocation engine.
 */

const ML_PORT = Number(process.env.ML_PORT) || 8000;

export interface TeacherFeaturesPayload {
  staff_id: string;
  teacher_preferred: number;
  teacher_max: number;
  prev_class_size?: number;
  subject_experience_years?: number;
  feedback_overcrowd_rate?: number;
  feedback_interaction?: number;
  hist_attendance?: number;
  prev_allocation_share?: number;
}

export interface ClassSizeRequestPayload {
  subject_code: string;
  student_demand: number;
  is_lab: number;
  credits?: number;
  semester?: number;
  room_capacity?: number;
  prev_enrollment?: number;
  teachers: TeacherFeaturesPayload[];
}

export interface MlCallResult {
  available: boolean;
  model?: string;
  predictions: Array<{ subject_code: string; staff_id: string; predicted_students: number }>;
  reason?: string;
}

export function getAllocationDefaults(): AllocationDefaults & { min_size: number } {
  const { rules } = getStoredRules();
  return {
    min_size: rules?.min_section_size ?? 30,
    default_size: rules?.default_section_size ?? 60,
    rules_max: rules?.max_section_size ?? 70,
  };
}

function postJson(path: string, body: unknown, timeoutMs = 8000): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: ML_PORT,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: timeoutMs,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, json: buf ? JSON.parse(buf) : {} });
          } catch {
            resolve({ status: res.statusCode || 500, json: { detail: buf } });
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('ML request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Calls the ML class-size endpoint. Never throws: an offline/untrained model yields {available:false}. */
export async function callClassSizeModel(requests: ClassSizeRequestPayload[]): Promise<MlCallResult> {
  if (requests.length === 0) return { available: true, predictions: [] };
  try {
    const { status, json } = await postJson('/api/forecast/class-size/predict', { requests });
    if (status !== 200) {
      return { available: false, predictions: [], reason: String(json?.detail || `ML service returned ${status}`) };
    }
    return { available: true, model: json.model, predictions: json.predictions || [] };
  } catch (err: any) {
    return { available: false, predictions: [], reason: `ML service offline on port ${ML_PORT} (${err.message})` };
  }
}

/** Features for one teacher on one subject, derived only from preferences, history and feedback (no leakage of the target). */
export function buildTeacherFeatures(staffId: string, subjectCode: string, profile: TeacherProfile): TeacherFeaturesPayload {
  const f: TeacherFeaturesPayload = { staff_id: staffId, teacher_preferred: profile.preferred, teacher_max: profile.max };

  const prev = db
    .prepare(
      `SELECT academic_year, class_size, attendance_rate FROM historical_allocations
       WHERE staff_id = ? AND subject_code = ? ORDER BY academic_year DESC LIMIT 1`
    )
    .get(staffId, subjectCode) as any;
  if (prev) {
    f.prev_class_size = prev.class_size;
    if (prev.attendance_rate != null) f.hist_attendance = prev.attendance_rate;
    const total = db
      .prepare(`SELECT SUM(class_size) AS t FROM historical_allocations WHERE subject_code = ? AND academic_year = ?`)
      .get(subjectCode, prev.academic_year) as any;
    if (total?.t) f.prev_allocation_share = Math.round((prev.class_size / total.t) * 1000) / 1000;
  }

  const fb = db
    .prepare(
      `SELECT AVG(overcrowded) AS oc, AVG(interaction_quality) AS iq FROM teacher_feedback WHERE staff_id = ? AND subject_code = ?`
    )
    .get(staffId, subjectCode) as any;
  if (fb?.oc != null) f.feedback_overcrowd_rate = fb.oc;
  if (fb?.iq != null) f.feedback_interaction = fb.iq;

  const exp = db
    .prepare(
      `SELECT subject_experience_years AS y FROM teacher_preferences WHERE staff_id = ? AND subject_code IN (?, '*')
       ORDER BY CASE subject_code WHEN '*' THEN 1 ELSE 0 END LIMIT 1`
    )
    .get(staffId, subjectCode) as any;
  if (exp?.y != null) f.subject_experience_years = exp.y;
  return f;
}

export interface SubjectContext {
  subject_code: string;
  subject_name: string;
  is_lab: number;
  credits: number | null;
  semester: number | null;
  hours_per_week: number;
  required_room_type: string;
  room_capacity: number;
  demand: number;
  prev_enrollment?: number;
  qualified_staff: string[];
}

/** Demand = students who chose the subject; falls back to current section sizes, then department/semester cohort. */
export function loadSubjectContext(subjectCode: string, defaults: AllocationDefaults): SubjectContext | null {
  const subj = db.prepare(`SELECT * FROM subjects WHERE subject_code = ?`).get(subjectCode) as any;
  if (!subj) return null;
  const isLab = subj.subject_type === 'lab' ? 1 : 0;
  const requiredRoom = subj.required_room_type || (isLab ? 'computer_lab' : 'classroom');

  let demand = (db.prepare(`SELECT COUNT(*) AS c FROM student_choices WHERE subject_code = ?`).get(subjectCode) as any)?.c || 0;
  if (demand === 0) demand = (db.prepare(`SELECT COALESCE(SUM(size),0) AS c FROM sections WHERE subject_code = ?`).get(subjectCode) as any)?.c || 0;
  if (demand === 0) {
    demand =
      (db
        .prepare(`SELECT COUNT(*) AS c FROM students WHERE (? IS NULL OR department = ?) AND (? IS NULL OR semester = ?)`)
        .get(subj.department ?? null, subj.department ?? null, subj.semester ?? null, subj.semester ?? null) as any)?.c || 0;
  }

  const roomCap = (db.prepare(`SELECT MAX(capacity) AS m FROM rooms WHERE status = 'active' AND room_type = ?`).get(requiredRoom) as any)?.m;
  const prevEnroll = db
    .prepare(`SELECT SUM(class_size) AS t FROM historical_allocations WHERE subject_code = ? GROUP BY academic_year ORDER BY academic_year DESC LIMIT 1`)
    .get(subjectCode) as any;
  const qualified = (db.prepare(`SELECT staff_id FROM staff_subjects WHERE subject_code = ? ORDER BY staff_id`).all(subjectCode) as any[]).map((r) => r.staff_id);

  return {
    subject_code: subjectCode,
    subject_name: subj.subject_name,
    is_lab: isLab,
    credits: subj.credits ?? null,
    semester: subj.semester ?? null,
    hours_per_week: subj.hours_per_week,
    required_room_type: requiredRoom,
    room_capacity: Math.min(roomCap || defaults.rules_max, defaults.rules_max),
    demand,
    prev_enrollment: prevEnroll?.t ?? undefined,
    qualified_staff: qualified,
  };
}

export function buildClassSizeRequest(ctx: SubjectContext, staffIds: string[], defaults: AllocationDefaults, demandOverride?: number): ClassSizeRequestPayload {
  return {
    subject_code: ctx.subject_code,
    student_demand: demandOverride ?? ctx.demand,
    is_lab: ctx.is_lab,
    credits: ctx.credits ?? undefined,
    semester: ctx.semester ?? undefined,
    room_capacity: ctx.room_capacity,
    prev_enrollment: ctx.prev_enrollment,
    teachers: staffIds.map((s) => buildTeacherFeatures(s, ctx.subject_code, resolveTeacherProfile(s, ctx.subject_code, defaults))),
  };
}

/**
 * Asks the ML model for expected class sizes and stores them (backend-owned write) as a new batch.
 * Each subject's prediction is a RECOMMENDATION only; hard limits are applied later by the allocation engine.
 */
export async function refreshClassPredictions(subjectCodes?: string[]): Promise<{
  available: boolean;
  batch_id: string | null;
  model?: string;
  stored: number;
  reason?: string;
}> {
  const defaults = getAllocationDefaults();
  const codes =
    subjectCodes && subjectCodes.length > 0
      ? subjectCodes
      : (db.prepare(`SELECT DISTINCT subject_code FROM staff_subjects ORDER BY subject_code`).all() as any[]).map((r) => r.subject_code);

  const requests: ClassSizeRequestPayload[] = [];
  for (const code of codes) {
    const ctx = loadSubjectContext(code, defaults);
    if (!ctx || ctx.demand === 0 || ctx.qualified_staff.length === 0) continue;
    requests.push(buildClassSizeRequest(ctx, ctx.qualified_staff, defaults));
  }

  const ml = await callClassSizeModel(requests);
  if (!ml.available) return { available: false, batch_id: null, stored: 0, reason: ml.reason };

  const batchId = `pred-${Date.now()}`;
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO class_predictions (batch_id, subject_code, staff_id, predicted_students, model_name, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const p of ml.predictions) ins.run(batchId, p.subject_code, p.staff_id, p.predicted_students, ml.model || 'class_size', 'synthetic-trained', now);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return { available: true, batch_id: batchId, model: ml.model, stored: ml.predictions.length };
}

export interface DistributionSuggestion {
  subject_code: string;
  subject_name: string;
  total_students: number;
  room_capacity: number;
  ml_used: boolean;
  ml_note?: string;
  teachers: Array<{
    staff_id: string;
    staff_name: string | null;
    /** total students across all of this teacher's batches */
    students: number;
    /** size of each batch/section (limits apply per batch: a teacher may run more than one section) */
    batch_sizes: number[];
    equal_split_would_be: number;
    preferred: number;
    preferred_source: string;
    max: number;
    ml_expected: number | null;
    rule: string;
    within_preferred: boolean;
  }>;
  unallocated: number;
  warnings: string[];
}

/**
 * Read-only: what the allocation engine would do for a subject if students were distributed from scratch.
 * `excluded_staff` lets callers model a teacher being unavailable. Nothing is written.
 */
export async function suggestStudentDistribution(opts: {
  subject_code: string;
  total_students?: number;
  excluded_staff?: string[];
  use_ml?: boolean;
}): Promise<DistributionSuggestion> {
  const defaults = getAllocationDefaults();
  const ctx = loadSubjectContext(opts.subject_code, defaults);
  if (!ctx) throw new Error(`Unknown subject ${opts.subject_code}.`);
  const excluded = new Set(opts.excluded_staff || []);
  const eligible = ctx.qualified_staff.filter((s) => !excluded.has(s));
  const total = opts.total_students ?? ctx.demand;
  if (eligible.length === 0) throw new Error(`No available qualified teacher for ${opts.subject_code}.`);

  // ML (advisory). If unavailable, fall back to the last stored batch, then to teacher preferences.
  const predictions = new Map<string, number>();
  let mlUsed = false;
  let mlNote: string | undefined;
  if (opts.use_ml !== false) {
    const ml = await callClassSizeModel([buildClassSizeRequest(ctx, eligible, defaults, total)]);
    if (ml.available && ml.predictions.length > 0) {
      for (const p of ml.predictions) predictions.set(`${p.subject_code}|${p.staff_id}`, p.predicted_students);
      mlUsed = true;
    } else {
      mlNote = `${ml.reason || 'ML unavailable'} - using teacher preferences/history only.`;
      for (const [k, v] of loadLatestPredictions()) predictions.set(k, v);
    }
  }

  const staffRows = db.prepare(`SELECT staff_id, staff_name, max_hours_per_week, hours_committed_elsewhere FROM staff`).all() as any[];
  const staffMap = new Map<string, any>(staffRows.map((s) => [s.staff_id, s]));
  const staff_hours = new Map<string, { max_hours: number; committed: number; assigned: number }>();
  for (const s of eligible) {
    const info = staffMap.get(s);
    staff_hours.set(s, { max_hours: info?.max_hours_per_week ?? 20, committed: info?.hours_committed_elsewhere ?? 0, assigned: 0 });
  }

  const floating = Array.from({ length: total }, (_, i) => `S${i + 1}`);
  const result = allocateSubject({
    subject_code: ctx.subject_code,
    hours_per_week: ctx.hours_per_week,
    room_capacity: ctx.room_capacity,
    min_section_size: getAllocationDefaults().min_size,
    qualified_staff: eligible,
    choices: [],
    floating_ids: floating,
    staff_hours,
    defaults,
    predictions,
  });

  const equal = Math.ceil(total / eligible.length);
  const byStaff = new Map<string, number>();
  const ruleBy = new Map<string, string>();
  const batchesBy = new Map<string, number[]>();
  for (const a of result.allocations) {
    byStaff.set(a.staff_id, (byStaff.get(a.staff_id) || 0) + a.student_ids.length);
    batchesBy.set(a.staff_id, [...(batchesBy.get(a.staff_id) || []), a.student_ids.length]);
    ruleBy.set(a.staff_id, a.basis.rule);
  }
  const teachers = eligible
    .filter((s) => byStaff.has(s))
    .map((s) => {
      const p = result.profiles.get(s)!;
      const n = byStaff.get(s)!;
      return {
        staff_id: s,
        staff_name: staffMap.get(s)?.staff_name ?? null,
        students: n,
        batch_sizes: batchesBy.get(s) || [n],
        equal_split_would_be: equal,
        preferred: p.preferred,
        preferred_source: p.preferred_source,
        max: p.max,
        ml_expected: predictions.get(`${ctx.subject_code}|${s}`) ?? null,
        rule: ruleBy.get(s) || 'demand_fill',
        within_preferred: Math.max(...(batchesBy.get(s) || [n])) <= p.preferred,
      };
    });

  return {
    subject_code: ctx.subject_code,
    subject_name: ctx.subject_name,
    total_students: total,
    room_capacity: ctx.room_capacity,
    ml_used: mlUsed,
    ml_note: mlNote,
    teachers,
    unallocated: result.unallocated_ids.length,
    warnings: result.warnings,
  };
}
