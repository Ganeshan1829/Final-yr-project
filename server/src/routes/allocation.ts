import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { refreshClassPredictions, suggestStudentDistribution } from '../services/engine/demandPredictionService.js';
import { seedSyntheticAllocationHistory } from '../services/engine/allocationSeedService.js';

export const allocationRouter = Router();

const PreferenceSchema = z.object({
  staff_id: z.string().min(1),
  subject_code: z.string().min(1).default('*'),
  preferred_class_size: z.number().int().min(1).max(500).optional(),
  max_class_size: z.number().int().min(1).max(500).optional(),
  subject_experience_years: z.number().min(0).max(60).optional(),
  lab_suitability: z.number().int().min(1).max(5).optional(),
  /** Explicit administrator permission to exceed the rules' maximum class size. HOD only. */
  admin_override_max: z.number().int().min(1).max(500).nullable().optional(),
});

const FeedbackSchema = z.object({
  staff_id: z.string().min(1),
  subject_code: z.string().min(1),
  academic_year: z.string().min(4),
  class_size: z.number().int().min(1).max(500),
  overcrowded: z.boolean().default(false),
  interaction_quality: z.number().int().min(1).max(5).optional(),
  allocation_success: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
});

function isHod(req: any): boolean {
  return String(req.headers['x-user-role'] || '').toLowerCase() === 'hod';
}

// GET /api/allocation/preferences?staff_id=
allocationRouter.get('/preferences', (req, res, next) => {
  try {
    const staffId = req.query.staff_id as string | undefined;
    const rows = staffId
      ? db.prepare(`SELECT * FROM teacher_preferences WHERE staff_id = ? ORDER BY subject_code`).all(staffId)
      : db.prepare(`SELECT * FROM teacher_preferences ORDER BY staff_id, subject_code`).all();
    res.json({ preferences: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/allocation/preferences  (upsert; preferences are soft, only admin_override_max can lift the hard cap)
allocationRouter.put('/preferences', (req, res, next) => {
  try {
    const body = PreferenceSchema.parse(req.body);
    if (body.admin_override_max !== undefined && !isHod(req)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the HOD can set an administrator override of the maximum class size.' } });
    }
    if (!db.prepare(`SELECT 1 FROM staff WHERE staff_id = ?`).get(body.staff_id)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Staff ${body.staff_id} not found` } });
    }
    if (body.preferred_class_size && body.max_class_size && body.preferred_class_size > body.max_class_size) {
      return res.status(400).json({ error: { code: 'INVALID', message: 'preferred_class_size cannot exceed max_class_size.' } });
    }
    const existing = db.prepare(`SELECT * FROM teacher_preferences WHERE staff_id = ? AND subject_code = ?`).get(body.staff_id, body.subject_code) as any;
    const merged = {
      preferred: body.preferred_class_size ?? existing?.preferred_class_size ?? null,
      max: body.max_class_size ?? existing?.max_class_size ?? null,
      exp: body.subject_experience_years ?? existing?.subject_experience_years ?? null,
      lab: body.lab_suitability ?? existing?.lab_suitability ?? null,
      override: body.admin_override_max !== undefined ? body.admin_override_max : existing?.admin_override_max ?? null,
    };
    db.prepare(
      `INSERT INTO teacher_preferences (staff_id, subject_code, preferred_class_size, max_class_size, subject_experience_years, lab_suitability, admin_override_max, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(staff_id, subject_code) DO UPDATE SET
         preferred_class_size = excluded.preferred_class_size, max_class_size = excluded.max_class_size,
         subject_experience_years = excluded.subject_experience_years, lab_suitability = excluded.lab_suitability,
         admin_override_max = excluded.admin_override_max, source = excluded.source, updated_at = excluded.updated_at`
    ).run(body.staff_id, body.subject_code, merged.preferred, merged.max, merged.exp, merged.lab, merged.override, isHod(req) ? 'admin' : 'feedback', new Date().toISOString());
    res.json({ ok: true, preference: db.prepare(`SELECT * FROM teacher_preferences WHERE staff_id = ? AND subject_code = ?`).get(body.staff_id, body.subject_code) });
  } catch (err) {
    next(err);
  }
});

// POST /api/allocation/feedback
allocationRouter.post('/feedback', (req, res, next) => {
  try {
    const body = FeedbackSchema.parse(req.body);
    if (!db.prepare(`SELECT 1 FROM staff WHERE staff_id = ?`).get(body.staff_id)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Staff ${body.staff_id} not found` } });
    }
    const info = db
      .prepare(
        `INSERT INTO teacher_feedback (staff_id, subject_code, academic_year, class_size, overcrowded, interaction_quality, allocation_success, comment, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'feedback', ?)`
      )
      .run(body.staff_id, body.subject_code, body.academic_year, body.class_size, body.overcrowded ? 1 : 0, body.interaction_quality ?? null, body.allocation_success ?? null, body.comment ?? null, new Date().toISOString());
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (err) {
    next(err);
  }
});

// GET /api/allocation/feedback?staff_id=
allocationRouter.get('/feedback', (req, res, next) => {
  try {
    const staffId = req.query.staff_id as string | undefined;
    const rows = staffId
      ? db.prepare(`SELECT * FROM teacher_feedback WHERE staff_id = ? ORDER BY academic_year DESC, id DESC LIMIT 200`).all(staffId)
      : db.prepare(`SELECT * FROM teacher_feedback ORDER BY id DESC LIMIT 200`).all();
    res.json({ feedback: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/allocation/seed-synthetic  - flagged synthetic history for the existing staff/subjects (demo/testing only)
allocationRouter.post('/seed-synthetic', (_req, res, next) => {
  try {
    res.json({ ok: true, data_origin: 'SYNTHETIC - not real college data', ...seedSyntheticAllocationHistory() });
  } catch (err) {
    next(err);
  }
});

// POST /api/allocation/predictions/refresh  - backend calls the ML service and stores advisory recommendations
allocationRouter.post('/predictions/refresh', async (req, res, next) => {
  try {
    const subjects = Array.isArray(req.body?.subject_codes) ? (req.body.subject_codes as string[]) : undefined;
    const out = await refreshClassPredictions(subjects);
    res.status(out.available ? 200 : 503).json(out);
  } catch (err) {
    next(err);
  }
});

// GET /api/allocation/predictions  - latest stored recommendation per (subject, teacher)
allocationRouter.get('/predictions', (_req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT p.* FROM class_predictions p
         JOIN (SELECT subject_code, staff_id, MAX(id) AS mid FROM class_predictions GROUP BY subject_code, staff_id) m ON m.mid = p.id
         ORDER BY p.subject_code, p.staff_id`
      )
      .all();
    res.json({ predictions: rows, advisory_only: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/allocation/distribution/:subject?total=&exclude=STF001,STF002&ml=0  - read-only suggestion
allocationRouter.get('/distribution/:subject', async (req, res, next) => {
  try {
    const total = req.query.total ? Number(req.query.total) : undefined;
    const exclude = req.query.exclude ? String(req.query.exclude).split(',').filter(Boolean) : undefined;
    const out = await suggestStudentDistribution({
      subject_code: req.params.subject,
      total_students: total && total > 0 ? total : undefined,
      excluded_staff: exclude,
      use_ml: req.query.ml !== '0',
    });
    res.json(out);
  } catch (err: any) {
    if (/Unknown subject|No available qualified/.test(err.message)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message } });
    }
    next(err);
  }
});
