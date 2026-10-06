import { db } from '../../db.js';

/**
 * Generates SYNTHETIC teacher preference / history / feedback rows for the staff and subjects that already
 * exist in the database, so the allocation + prediction flow can be demonstrated end-to-end.
 * Every row is flagged (`is_synthetic = 1` / `source = 'synthetic'`). This is NOT real college data and
 * real feedback entered through the API is never overwritten.
 *
 * Realistic relationships: a teacher has a stable comfort size; actual past class sizes drift around it with
 * subject demand; crowding above the comfort size raises the overcrowding flag and lowers interaction quality.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function seedSyntheticAllocationHistory(opts: { years?: string[]; seed?: number } = {}): {
  teachers: number;
  historical_allocations: number;
  feedback: number;
} {
  const years = opts.years ?? ['2022-23', '2023-24', '2024-25', '2025-26'];
  const seed = opts.seed ?? 11;
  const now = new Date().toISOString();

  const pairs = db
    .prepare(
      `SELECT ss.staff_id, ss.subject_code, sub.subject_type, COALESCE((SELECT MAX(capacity) FROM rooms WHERE room_type = sub.required_room_type AND status = 'active'), 60) AS room_cap
       FROM staff_subjects ss JOIN subjects sub ON sub.subject_code = ss.subject_code ORDER BY ss.staff_id, ss.subject_code`
    )
    .all() as any[];

  const insPref = db.prepare(
    `INSERT INTO teacher_preferences (staff_id, subject_code, preferred_class_size, max_class_size, subject_experience_years, lab_suitability, source, updated_at)
     VALUES (?, '*', ?, ?, ?, ?, 'synthetic', ?)
     ON CONFLICT(staff_id, subject_code) DO UPDATE SET
       preferred_class_size = excluded.preferred_class_size, max_class_size = excluded.max_class_size,
       subject_experience_years = excluded.subject_experience_years, lab_suitability = excluded.lab_suitability, updated_at = excluded.updated_at
     WHERE teacher_preferences.source = 'synthetic'`
  );
  const insHist = db.prepare(
    `INSERT OR REPLACE INTO historical_allocations (academic_year, subject_code, staff_id, class_size, attendance_rate, room_capacity, is_synthetic, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const delFb = db.prepare(`DELETE FROM teacher_feedback WHERE source = 'synthetic'`);
  const insFb = db.prepare(
    `INSERT INTO teacher_feedback (staff_id, subject_code, academic_year, class_size, overcrowded, interaction_quality, allocation_success, comment, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC feedback', 'synthetic', ?)`
  );

  const traits = new Map<string, { preferred: number; max: number; experience: number; lab: number }>();
  const staffIds = [...new Set(pairs.map((p) => p.staff_id as string))];
  for (const id of staffIds) {
    const r = mulberry32(hash(id) ^ seed);
    const preferred = [20, 25, 30, 35, 40][Math.floor(r() * 5)];
    traits.set(id, { preferred, max: preferred + 5 + Math.floor(r() * 8), experience: Math.round((1 + r() * 20) * 10) / 10, lab: 1 + Math.floor(r() * 5) });
  }

  let hist = 0;
  let fb = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    delFb.run();
    for (const id of staffIds) {
      const t = traits.get(id)!;
      insPref.run(id, t.preferred, t.max, t.experience, t.lab, now);
    }
    for (const p of pairs) {
      const t = traits.get(p.staff_id)!;
      const r = mulberry32(hash(`${p.staff_id}|${p.subject_code}`) ^ seed);
      let prev = t.preferred;
      for (const y of years) {
        // size drifts around comfort size, bounded by the room and the teacher's max
        const size = Math.max(10, Math.min(Math.round(prev * (0.88 + r() * 0.26)), p.room_cap, t.max));
        const over = size > t.preferred * 1.1;
        const attendance = Math.round(Math.max(0.55, Math.min(0.97, 0.9 - (size / t.max) * 0.12 + (r() - 0.5) * 0.06)) * 1000) / 1000;
        insHist.run(y, p.subject_code, p.staff_id, size, attendance, p.room_cap, now);
        hist++;
        const interaction = Math.max(1, Math.min(5, Math.round(4.6 - (size / t.max) * 1.4 + (r() - 0.5))));
        insFb.run(p.staff_id, p.subject_code, y, size, over ? 1 : 0, interaction, over ? 3 : 4, now);
        fb++;
        prev = size;
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return { teachers: staffIds.length, historical_allocations: hist, feedback: fb };
}
