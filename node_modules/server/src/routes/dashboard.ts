import { Router, Request, Response } from 'express';
import {
  getDashboardSummary,
  getRoomUse,
  getClashesAnalysis,
  getHoursAnalysis,
  getWorkloadAnalysis,
  getChangesAnalysis,
  DashboardFilters,
} from '../services/dashboard/dashboardService.js';

export const dashboardRouter = Router();

function parseFilters(req: Request): DashboardFilters {
  return {
    department: typeof req.query.department === 'string' && req.query.department ? req.query.department : undefined,
    semester: req.query.semester ? parseInt(String(req.query.semester), 10) : undefined,
    subject: typeof req.query.subject === 'string' && req.query.subject ? req.query.subject : undefined,
    staff: typeof req.query.staff === 'string' && req.query.staff ? req.query.staff : undefined,
    date_from: typeof req.query.date_from === 'string' ? req.query.date_from : undefined,
    date_to: typeof req.query.date_to === 'string' ? req.query.date_to : undefined,
  };
}

/**
 * GET /api/dashboard/summary
 * KPI strip: timetable status, semester dates, total sections, total weekly periods,
 * clashes (must read 0), shortfall hours, changes applied, last run time, stale detection.
 */
dashboardRouter.get('/summary', (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const summary = getDashboardSummary(filters);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to fetch dashboard summary' } });
  }
});

/**
 * GET /api/dashboard/room-use
 * Room utilization %, heatmap grid, wasted seats analysis (average, top 10 mismatches, total seat-periods),
 * underused / overloaded rooms, theory vs lab comparison.
 */
dashboardRouter.get('/room-use', (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const underusedThreshold = req.query.underused_threshold
      ? parseFloat(String(req.query.underused_threshold))
      : 30;
    const overloadedThreshold = req.query.overloaded_threshold
      ? parseFloat(String(req.query.overloaded_threshold))
      : 85;

    const roomData = getRoomUse(filters, underusedThreshold, overloadedThreshold);
    res.json(roomData);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to fetch room use metrics' } });
  }
});

/**
 * GET /api/dashboard/clashes
 * Independent clash verification against both weekly slots and calendar sessions.
 */
dashboardRouter.get('/clashes', (_req: Request, res: Response) => {
  try {
    const clashes = getClashesAnalysis();
    res.json(clashes);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to run clash verification' } });
  }
});

/**
 * GET /api/dashboard/hours
 * Required vs delivered hours per course/section, shortfall progress, department breakdown,
 * make-up hours recovered.
 */
dashboardRouter.get('/hours', (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const hoursData = getHoursAnalysis(filters);
    res.json(hoursData);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to fetch hours analysis' } });
  }
});

/**
 * GET /api/dashboard/workload
 * Weekly hours per faculty vs max load limits, overload flags.
 */
dashboardRouter.get('/workload', (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const workload = getWorkloadAnalysis(filters);
    res.json(workload);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to fetch workload metrics' } });
  }
});

/**
 * GET /api/dashboard/changes
 * Summary of applied management changes and recent change log entries.
 */
dashboardRouter.get('/changes', (_req: Request, res: Response) => {
  try {
    const changes = getChangesAnalysis();
    res.json(changes);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message || 'Failed to fetch management changes analysis' } });
  }
});
