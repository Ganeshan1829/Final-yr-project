import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { getLatestEtlRun } from '../db/repositories/etlRepository.js';
import {
  runSectionSplitter,
  getSections,
  editSectionSize,
} from '../services/engine/sectionSplitter.js';
import {
  runWeeklySolver,
  getTimetableSlots,
  getLatestSolverRun,
  getSolverStatus,
  checkPythonEnvironment,
} from '../services/engine/solverService.js';
import {
  generateSemesterCalendar,
  getHoursSummary,
  getMakeups,
  approveMakeup,
  rejectMakeup,
  getCalendarSessions,
} from '../services/engine/calendarService.js';

export const engineRouter = Router();

/**
 * Gatekeeper middleware: ensures Module 2 validation passed and is not stale.
 */
function ensureValidationGate(req: Request, res: Response, next: () => void) {
  const latestRun = getLatestEtlRun();
  const isValidationPassed = latestRun?.status === 'passed';
  const isValidationStale = latestRun?.stale === 1 || Boolean(latestRun?.isStale);

  if (!latestRun || !isValidationPassed || isValidationStale) {
    return res.status(403).json({
      error: 'ValidationGateBlocked',
      message:
        'Timetable Engine requires Module 2 ETL Validation to pass with 0 blocking errors and not be stale. Please re-run validation on /validation.',
      latestRun,
    });
  }
  next();
}

/**
 * GET /api/engine/status
 * Returns system readiness, python/ortools state, step progress, and stale flags.
 */
engineRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const latestEtl = getLatestEtlRun();
    const isValidationPassed = latestEtl?.status === 'passed';
    const isValidationStale = latestEtl?.stale === 1 || Boolean(latestEtl?.isStale);
    const canProceed = Boolean(isValidationPassed && !isValidationStale);

    // Python / OR-Tools environment check
    const pyCheck = await checkPythonEnvironment();

    // Query engine_state
    const stateStmt = db.prepare(`SELECT * FROM engine_state WHERE id = 1`);
    let state = stateStmt.get() as any;
    if (!state) {
      db.prepare(`
        INSERT INTO engine_state (id, split_status, solve_status, calendar_status, stale)
        VALUES (1, 'not_run', 'not_run', 'not_run', 0)
      `).run();
      state = stateStmt.get();
    }

    // Counts
    const secCount = (db.prepare(`SELECT count(*) as c FROM sections`).get() as any)?.c || 0;
    const slotCount = (db.prepare(`SELECT count(*) as c FROM timetable_slots`).get() as any)?.c || 0;
    const sessCount = (db.prepare(`SELECT count(*) as c FROM calendar_sessions`).get() as any)?.c || 0;
    const makeupCount = (db.prepare(`SELECT count(*) as c FROM suggested_makeups`).get() as any)?.c || 0;
    const shortfallCount =
      (db.prepare(`SELECT count(*) as c FROM hours_summary WHERE shortfall_hours > 0`).get() as any)?.c || 0;

    const latestRun = getLatestSolverRun();

    return res.json({
      can_proceed: canProceed,
      validation_status: {
        has_run: Boolean(latestEtl),
        passed: isValidationPassed,
        stale: isValidationStale,
        run_id: latestEtl?.id,
      },
      environment: {
        python_ready: pyCheck.ready,
        ortools_version: pyCheck.version,
        error: pyCheck.error,
      },
      state: {
        split_status: state.split_status,
        solve_status: state.solve_status,
        calendar_status: state.calendar_status,
        stale: state.stale === 1,
        split_error: state.split_error,
        solve_error: state.solve_error,
        last_split_at: state.last_split_at,
        last_solve_at: state.last_solve_at,
        last_calendar_at: state.last_calendar_at,
      },
      counts: {
        sections: secCount,
        slots: slotCount,
        sessions: sessCount,
        makeups: makeupCount,
        shortfall_sections: shortfallCount,
      },
      latest_solver_run: latestRun,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve engine status', message: err.message });
  }
});

/**
 * POST /api/engine/split
 * Runs the deterministic Section Splitter (Part 1).
 */
engineRouter.post('/split', ensureValidationGate, (_req: Request, res: Response) => {
  try {
    const summary = runSectionSplitter();
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: 'Section splitting failed', message: err.message });
  }
});

/**
 * GET /api/engine/sections
 * Returns current sections.
 */
engineRouter.get('/sections', (_req: Request, res: Response) => {
  try {
    const sections = getSections();
    return res.json({ count: sections.length, sections });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch sections', message: err.message });
  }
});

/**
 * PATCH /api/engine/sections/:id
 * Previews or applies manual section size edit (Week 10 intake change case).
 */
engineRouter.patch('/sections/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { size, confirm } = req.body;
    if (!size || typeof size !== 'number' || size <= 0) {
      return res.status(400).json({ error: 'Invalid section size' });
    }

    const result = editSectionSize(id, size, Boolean(confirm));
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to edit section size', message: err.message });
  }
});

/**
 * POST /api/engine/solve
 * Runs OR-Tools Weekly Timetable Solver (Part 2).
 */
engineRouter.post('/solve', ensureValidationGate, async (req: Request, res: Response) => {
  try {
    const timeLimit = req.body?.time_limit_seconds ? Number(req.body.time_limit_seconds) : 60;
    const summary = await runWeeklySolver(timeLimit);
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: 'Solver execution failed', message: err.message });
  }
});

/**
 * GET /api/engine/solver-status
 * Polling endpoint for solver progress.
 */
engineRouter.get('/solver-status', (_req: Request, res: Response) => {
  return res.json(getSolverStatus());
});

/**
 * GET /api/engine/timetable
 * Returns scheduled weekly timetable slots.
 */
engineRouter.get('/timetable', (req: Request, res: Response) => {
  try {
    const filters: any = {};
    if (req.query.section_id) filters.section_id = Number(req.query.section_id);
    if (req.query.staff_id) filters.staff_id = String(req.query.staff_id);
    if (req.query.room_id) filters.room_id = String(req.query.room_id);
    if (req.query.day_of_week) filters.day_of_week = Number(req.query.day_of_week);

    const slots = getTimetableSlots(filters);
    const latestRun = getLatestSolverRun();

    return res.json({
      count: slots.length,
      slots,
      latest_run: latestRun,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch timetable slots', message: err.message });
  }
});

/**
 * POST /api/engine/calendar
 * Generates the full semester calendar (Part 3).
 */
engineRouter.post('/calendar', ensureValidationGate, (_req: Request, res: Response) => {
  try {
    const summary = generateSemesterCalendar();
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: 'Calendar generation failed', message: err.message });
  }
});

/**
 * GET /api/engine/calendar
 * Returns calendar sessions with filtering.
 */
engineRouter.get('/calendar', (req: Request, res: Response) => {
  try {
    const filters: any = {};
    if (req.query.month) filters.month = String(req.query.month);
    if (req.query.date) filters.date = String(req.query.date);
    if (req.query.section_id) filters.section_id = Number(req.query.section_id);
    if (req.query.staff_id) filters.staff_id = String(req.query.staff_id);
    if (req.query.room_id) filters.room_id = String(req.query.room_id);
    if (req.query.status) filters.status = String(req.query.status);

    const sessions = getCalendarSessions(filters);
    return res.json({ count: sessions.length, sessions });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch calendar sessions', message: err.message });
  }
});

/**
 * GET /api/engine/hours-summary
 * Returns course hours required vs delivered vs shortfalls.
 */
engineRouter.get('/hours-summary', (_req: Request, res: Response) => {
  try {
    const summary = getHoursSummary();
    const totalShortfall = summary.reduce((acc, row) => acc + row.shortfall_hours, 0);
    return res.json({ count: summary.length, total_shortfall_hours: totalShortfall, summary });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch hours summary', message: err.message });
  }
});

/**
 * GET /api/engine/makeups
 * Returns suggested make-up classes.
 */
engineRouter.get('/makeups', (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const makeups = getMakeups(status);
    return res.json({ count: makeups.length, makeups });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch make-ups', message: err.message });
  }
});

/**
 * POST /api/engine/makeups/:id/approve
 * Approves a make-up class and writes into calendar_sessions.
 */
engineRouter.post('/makeups/:id/approve', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = approveMakeup(id);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to approve make-up class', message: err.message });
  }
});

/**
 * POST /api/engine/makeups/:id/reject
 * Rejects a make-up class.
 */
engineRouter.post('/makeups/:id/reject', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = rejectMakeup(id);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to reject make-up class', message: err.message });
  }
});

/**
 * GET /api/engine/export/timetable.csv
 * Exports weekly timetable as CSV.
 */
engineRouter.get('/export/timetable.csv', (_req: Request, res: Response) => {
  try {
    const slots = getTimetableSlots();
    const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let csv = 'Day,Period,Subject Code,Subject Name,Section,Faculty Name,Room,Room Name,Is Lab Block\n';
    for (const s of slots) {
      const dayStr = dayNames[s.day_of_week] || `Day ${s.day_of_week}`;
      const line = [
        dayStr,
        s.period,
        `"${s.subject_code}"`,
        `"${(s.subject_name || '').replace(/"/g, '""')}"`,
        `"${s.section_id}"`,
        `"${(s.staff_name || '').replace(/"/g, '""')}"`,
        `"${s.room_id}"`,
        `"${(s.room_name || '').replace(/"/g, '""')}"`,
        s.is_lab_block === 1 ? 'Yes' : 'No',
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="weekly_timetable.csv"');
    return res.status(200).send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to export timetable CSV', message: err.message });
  }
});

/**
 * GET /api/engine/export/hours.csv
 * Exports hours summary as CSV.
 */
engineRouter.get('/export/hours.csv', (_req: Request, res: Response) => {
  try {
    const summary = getHoursSummary();
    let csv = 'Subject Code,Subject Name,Section,Faculty,Required Hours,Delivered Hours,Shortfall Hours,Makeups Approved\n';
    for (const r of summary) {
      const line = [
        `"${r.subject_code}"`,
        `"${r.subject_name.replace(/"/g, '""')}"`,
        `"${r.section_label}"`,
        `"${r.staff_name.replace(/"/g, '""')}"`,
        r.required_hours,
        r.delivered_hours,
        r.shortfall_hours,
        r.makeup_approved_hours,
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hours_summary.csv"');
    return res.status(200).send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to export hours CSV', message: err.message });
  }
});
