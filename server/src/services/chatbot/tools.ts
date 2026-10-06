import { z } from 'zod';
import { db } from '../../db.js';
import { previewChange, ImpactSummary } from '../changes/changesService.js';
import { computeTimetableInsights, InsightsResult } from './insightsService.js';
import { refreshClassPredictions, suggestStudentDistribution } from '../engine/demandPredictionService.js';

export type UserRole = 'student' | 'staff' | 'hod';

export interface UserContext {
  userId: string;
  role: UserRole;
  sectionId?: string; // for students
}

export interface ToolExecutionResult {
  success: boolean;
  tool: string;
  args: any;
  result?: any;
  preview?: any;
  isWhatIf?: boolean;
  denied?: boolean;
  message?: string;
}

// -------------------------------------------------------------
// Tool Input Schemas (Zod)
// -------------------------------------------------------------

export const FindFreeRoomsSchema = z.object({
  date: z.string().describe('Target date in YYYY-MM-DD format'),
  period: z.number().int().min(1).max(10).optional().describe('Specific period number (1-based)'),
  start_period: z.number().int().min(1).max(10).optional(),
  end_period: z.number().int().min(1).max(10).optional(),
  min_capacity: z.number().int().positive().optional().describe('Minimum required room capacity'),
  room_type: z.enum(['lecture', 'lab', 'classroom', 'computer_lab', 'seminar_hall', 'auditorium', 'any']).optional().describe('Room type filter'),
});

export const GetTimetableSchema = z.object({
  scope: z.enum(['section', 'staff', 'room', 'day', 'range']),
  value: z.string().optional().describe('Specific ID: section ID, staff ID, or room ID'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const GetStaffFreeSlotsSchema = z.object({
  staff_id: z.string().describe('Staff ID e.g. STF001'),
  date: z.string().optional().describe('Target date YYYY-MM-DD'),
  week_number: z.number().int().positive().optional(),
});

export const GetHoursLeftSchema = z.object({
  subject_code: z.string().optional(),
  section_id: z.string().optional(),
});

export const ListHolidaysSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const ListEventsSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const ListLeaveSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  staff_id: z.string().optional(),
});

export const ExportRequestSchema = z.object({
  kind: z.enum(['timetable', 'hours summary']),
});

export const PreviewAddLeaveSchema = z.object({
  staff_id: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  periods: z.array(z.number().int()).optional(),
  reason: z.string().optional(),
});

export const PreviewAddEventSchema = z.object({
  name: z.string(),
  date: z.string(),
  start_period: z.number().int().min(1).max(10),
  end_period: z.number().int().min(1).max(10),
  venue_room_id: z.string(),
  involved_staff_ids: z.array(z.string()).optional(),
  involved_section_ids: z.array(z.string()).optional(),
});

export const PreviewChangeIntakeSchema = z.object({
  section_id: z.string(),
  new_size: z.number().int().positive(),
});

export const PreviewWhatIfSchema = z.object({
  type: z.enum(['leave', 'event', 'intake']),
  payload: z.record(z.any()),
});

export const SuggestSubstitutesSchema = z.object({
  staff_id: z.string(),
  start_date: z.string(),
  end_date: z.string(),
});

export const InsightsSchema = z.object({
  threshold_utilization: z.number().optional(),
  wasted_seats_min: z.number().optional(),
});

export const PredictClassDemandSchema = z.object({
  subject_codes: z.array(z.string()).optional().describe('Subjects to predict; omit for all subjects with qualified teachers'),
});

export const SuggestStudentDistributionSchema = z.object({
  subject_code: z.string(),
  total_students: z.number().int().positive().optional().describe('Override student count; defaults to current demand'),
  unavailable_staff_ids: z.array(z.string()).optional().describe('Teachers to exclude from the distribution'),
});

export const SimulateTeacherAllocationSchema = z.object({
  unavailable_staff_ids: z.array(z.string()).min(1),
  subject_codes: z.array(z.string()).optional(),
  effective_date: z.string().optional().describe('YYYY-MM-DD; teachers on approved leave that day are also treated as unavailable'),
  reason: z.string().optional(),
  stage: z.boolean().optional().describe('false/omitted = hypothetical what-if; true = stage a draft the HOD must confirm'),
});

// Tool Definitions Registry (for LLM Function Calling)
export const TOOL_DEFINITIONS = [
  {
    name: 'find_free_rooms',
    description: 'Find rooms that are free and unoccupied at a specific date and period.',
    parameters: FindFreeRoomsSchema,
  },
  {
    name: 'get_timetable',
    description: 'Get schedule and sessions for a section, staff member, room, or specific date.',
    parameters: GetTimetableSchema,
  },
  {
    name: 'get_staff_free_slots',
    description: 'Find free unoccupied periods for a faculty member on a date or week.',
    parameters: GetStaffFreeSlotsSchema,
  },
  {
    name: 'get_hours_left',
    description: 'Check required vs delivered vs shortfall hours for a subject or section.',
    parameters: GetHoursLeftSchema,
  },
  {
    name: 'list_holidays',
    description: 'List calendar holidays in the semester or date range.',
    parameters: ListHolidaysSchema,
  },
  {
    name: 'list_events',
    description: 'List institutional events and room bookings.',
    parameters: ListEventsSchema,
  },
  {
    name: 'list_leave',
    description: 'List approved faculty leave periods.',
    parameters: ListLeaveSchema,
  },
  {
    name: 'export_request',
    description: 'Get download link for timetable CSV or hours summary CSV.',
    parameters: ExportRequestSchema,
  },
  {
    name: 'preview_add_leave',
    description: 'Preview the impact of marking a staff member on leave (creates a draft change preview only).',
    parameters: PreviewAddLeaveSchema,
  },
  {
    name: 'preview_add_event',
    description: 'Preview the impact of blocking a room or scheduling an event (creates a draft change preview only).',
    parameters: PreviewAddEventSchema,
  },
  {
    name: 'preview_change_intake',
    description: 'Preview the impact of resizing a section (moves to larger room if needed; preview only).',
    parameters: PreviewChangeIntakeSchema,
  },
  {
    name: 'preview_what_if',
    description: 'Run a hypothetical "what-if" scenario without creating any draft change.',
    parameters: PreviewWhatIfSchema,
  },
  {
    name: 'suggest_substitutes',
    description: 'Find qualified, available substitute faculty ranked by least teaching load.',
    parameters: SuggestSubstitutesSchema,
  },
  {
    name: 'insights',
    description: 'Deterministic analytics on underused rooms, wasted seats, staff workload gaps, and shortfall risks.',
    parameters: InsightsSchema,
  },
  {
    name: 'predict_class_demand',
    description: 'Refresh ML class-size recommendations per teacher/subject (advisory only; hard limits are enforced by the allocation engine).',
    parameters: PredictClassDemandSchema,
  },
  {
    name: 'suggest_student_distribution',
    description: 'Show how students of a subject would be split across qualified teachers using preferences, history, ML and hard limits (read-only).',
    parameters: SuggestStudentDistributionSchema,
  },
  {
    name: 'simulate_teacher_allocation',
    description: 'Simulate redistributing students of unavailable teachers to other teachers of the same subject. Hypothetical unless stage=true, which creates a draft the HOD must confirm.',
    parameters: SimulateTeacherAllocationSchema,
  },
];

/** Tools that call the ML service and therefore must be executed with executeToolAsync. */
export const ASYNC_TOOLS = ['predict_class_demand', 'suggest_student_distribution'];

// Helper: Sanitize database text against prompt injection
export function sanitizeDataText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/```/g, "'''")
    .replace(/<system>/gi, '')
    .replace(/<\/system>/gi, '')
    .replace(/\[INST\]/gi, '')
    .replace(/\[\/INST\]/gi, '')
    .replace(/ignore (all )?previous instructions/gi, '[filtered]');
}

// -------------------------------------------------------------
// Audit Logger
// -------------------------------------------------------------
export function logAudit(
  user: string,
  role: string,
  tool: string,
  args: any,
  status: 'success' | 'denied' | 'error',
  details?: any
) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user, role, tool, arguments, status, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      user,
      role,
      tool,
      JSON.stringify(args || {}),
      status,
      typeof details === 'object' ? JSON.stringify(details) : (details || ''),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to write audit_log:', err);
  }
}

// -------------------------------------------------------------
// Deterministic Tool Implementations
// -------------------------------------------------------------

const ALLOCATION_TOOLS = ['predict_class_demand', 'suggest_student_distribution', 'simulate_teacher_allocation'];

/** Server-side role enforcement shared by the sync and async executors. Returns a denial result or null. */
function denyIfForbidden(toolName: string, rawArgs: any, userCtx: UserContext): ToolExecutionResult | null {
  const { userId, role } = userCtx;
  if (role === 'student') {
    const studentForbidden = [
      'list_leave',
      'get_staff_free_slots',
      'preview_add_leave',
      'preview_add_event',
      'preview_change_intake',
      'preview_what_if',
      'suggest_substitutes',
      'insights',
      ...ALLOCATION_TOOLS,
    ];
    if (studentForbidden.includes(toolName)) {
      logAudit(userId, role, toolName, rawArgs, 'denied', 'Student role permission denied');
      return {
        success: false,
        tool: toolName,
        args: rawArgs,
        denied: true,
        message: 'Permission denied: Students cannot access staff private data or management planning tools.',
      };
    }
  } else if (role === 'staff') {
    const staffForbidden = ['preview_add_event', 'preview_change_intake', ...ALLOCATION_TOOLS];
    if (staffForbidden.includes(toolName)) {
      logAudit(userId, role, toolName, rawArgs, 'denied', 'Staff role cannot perform institutional event, intake or allocation changes');
      return {
        success: false,
        tool: toolName,
        args: rawArgs,
        denied: true,
        message: 'Permission denied: Only the Head of Department (HOD) can schedule institutional events, alter section intake sizes, or plan teacher/student allocation.',
      };
    }
  }
  return null;
}

/** Async executor: handles ML-backed tools, delegates everything else to the deterministic sync executor. */
export async function executeToolAsync(toolName: string, rawArgs: any, userCtx: UserContext): Promise<ToolExecutionResult> {
  if (!ASYNC_TOOLS.includes(toolName)) return executeTool(toolName, rawArgs, userCtx);
  const { userId, role } = userCtx;
  const denied = denyIfForbidden(toolName, rawArgs, userCtx);
  if (denied) return denied;
  try {
    if (toolName === 'predict_class_demand') {
      const args = PredictClassDemandSchema.parse(rawArgs);
      const out = await refreshClassPredictions(args.subject_codes);
      logAudit(userId, role, toolName, args, out.available ? 'success' : 'error', out);
      return {
        success: out.available,
        tool: toolName,
        args,
        result: out,
        message: out.available ? undefined : `ML prediction unavailable: ${out.reason}. Allocation continues using teacher preferences and history.`,
      };
    }
    const args = SuggestStudentDistributionSchema.parse(rawArgs);
    const out = await suggestStudentDistribution({
      subject_code: args.subject_code,
      total_students: args.total_students,
      excluded_staff: args.unavailable_staff_ids,
    });
    logAudit(userId, role, toolName, args, 'success');
    return { success: true, tool: toolName, args, result: out };
  } catch (err: any) {
    logAudit(userId, role, toolName, rawArgs, 'error', err.message);
    return { success: false, tool: toolName, args: rawArgs, message: `Tool execution failed: ${err.message}` };
  }
}

export function executeTool(
  toolName: string,
  rawArgs: any,
  userCtx: UserContext
): ToolExecutionResult {
  const { userId, role } = userCtx;

  // 1. Role permission checks (Enforced in server layer)
  const denied = denyIfForbidden(toolName, rawArgs, userCtx);
  if (denied) return denied;

  try {
    switch (toolName) {
      // ---------------------------------------------------------
      // 1. find_free_rooms
      // ---------------------------------------------------------
      case 'find_free_rooms': {
        const args = FindFreeRoomsSchema.parse(rawArgs);
        const startP = args.start_period || args.period || 1;
        const endP = args.end_period || args.period || 1;

        // Query rooms not booked in calendar_sessions
        let query = `
          SELECT r.room_id as id, r.room_name as name, r.capacity, r.room_type as type
          FROM rooms r
          WHERE r.status = 'active'
        `;
        const params: any[] = [];

        if (args.min_capacity) {
          query += ' AND r.capacity >= ?';
          params.push(args.min_capacity);
        }
        if (args.room_type && args.room_type !== 'any') {
          const mappedType = args.room_type === 'lecture' ? 'classroom' : args.room_type === 'lab' ? 'computer_lab' : args.room_type;
          query += ' AND r.room_type = ?';
          params.push(mappedType);
        }

        query += `
          AND r.room_id NOT IN (
            SELECT room_id FROM calendar_sessions
            WHERE session_date = ? AND period >= ? AND period <= ? AND status IN ('scheduled', 'makeup')
          )
        `;
        params.push(args.date, startP, endP);

        // Also check if any approved event blocks the room
        query += `
          AND r.room_id NOT IN (
            SELECT json_extract(payload, '$.venue_room_id') FROM changes
            WHERE type = 'event' AND status = 'applied'
              AND json_extract(payload, '$.date') = ?
              AND CAST(json_extract(payload, '$.start_period') AS INT) <= ?
              AND CAST(json_extract(payload, '$.end_period') AS INT) >= ?
          )
        `;
        params.push(args.date, endP, startP);

        query += ' ORDER BY r.capacity ASC';
        const freeRooms = db.prepare(query).all(...params);

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: {
            date: args.date,
            period_range: `${startP} - ${endP}`,
            total_free: freeRooms.length,
            rooms: freeRooms,
          },
        };
      }

      // ---------------------------------------------------------
      // 2. get_timetable
      // ---------------------------------------------------------
      case 'get_timetable': {
        const args = GetTimetableSchema.parse(rawArgs);

        // Permissions check for student scope
        if (role === 'student' && args.scope === 'section' && userCtx.sectionId && args.value && args.value !== userCtx.sectionId) {
          logAudit(userId, role, toolName, args, 'denied', 'Student tried to view another section timetable');
          return {
            success: false,
            tool: toolName,
            args,
            denied: true,
            message: `Permission restricted: You are registered in ${userCtx.sectionId}. You cannot inspect other cohort schedules.`,
          };
        }

        let query = `
          SELECT cs.session_id as id, cs.session_date as date, cs.period, cs.subject_code, sub.subject_name,
                 cs.section_id, cs.staff_id, stf.staff_name, cs.room_id, r.room_name,
                 cs.status
          FROM calendar_sessions cs
          LEFT JOIN subjects sub ON cs.subject_code = sub.subject_code
          LEFT JOIN staff stf ON cs.staff_id = stf.staff_id
          LEFT JOIN rooms r ON cs.room_id = r.room_id
          WHERE cs.status IN ('scheduled', 'makeup')
        `;
        const params: any[] = [];

        if (args.scope === 'section' && args.value) {
          // Accept either the section label (CS301-S1) or its numeric id
          query += ' AND cs.section_id IN (SELECT section_id FROM sections WHERE section_label = ? COLLATE NOCASE OR CAST(section_id AS TEXT) = ?)';
          params.push(args.value, args.value);
        } else if (args.scope === 'staff' && args.value) {
          query += ' AND cs.staff_id = ?';
          params.push(args.value);
        } else if (args.scope === 'room' && args.value) {
          query += ' AND cs.room_id = ?';
          params.push(args.value);
        } else if (args.scope === 'day' && args.value) {
          query += ' AND cs.session_date = ?';
          params.push(args.value);
        }

        if (args.start_date) {
          query += ' AND cs.session_date >= ?';
          params.push(args.start_date);
        }
        if (args.end_date) {
          query += ' AND cs.session_date <= ?';
          params.push(args.end_date);
        }

        query += ' ORDER BY cs.session_date ASC, cs.period ASC LIMIT 60';
        const sessions = db.prepare(query).all(...params);

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: {
            scope: args.scope,
            count: sessions.length,
            sessions,
          },
        };
      }

      // ---------------------------------------------------------
      // 3. get_staff_free_slots
      // ---------------------------------------------------------
      case 'get_staff_free_slots': {
        const args = GetStaffFreeSlotsSchema.parse(rawArgs);

        // Staff can only query own free slots unless HOD
        if (role === 'staff' && args.staff_id !== userId) {
          logAudit(userId, role, toolName, args, 'denied', 'Staff tried to query another faculty free slots');
          return {
            success: false,
            tool: toolName,
            args,
            denied: true,
            message: 'Permission restricted: Faculty members can only query their own teaching schedule and free slots.',
          };
        }

        const date = args.date || new Date().toISOString().split('T')[0];
        const busyPeriods = db.prepare(`
          SELECT period FROM calendar_sessions
          WHERE staff_id = ? AND session_date = ? AND status IN ('scheduled', 'makeup')
        `).all(args.staff_id, date).map((r: any) => r.period);

        const periodsPerDay = 7;
        const freePeriods = [];
        for (let p = 1; p <= periodsPerDay; p++) {
          if (!busyPeriods.includes(p)) {
            freePeriods.push(p);
          }
        }

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: {
            staff_id: args.staff_id,
            date,
            free_periods: freePeriods,
            busy_periods: busyPeriods,
          },
        };
      }

      // ---------------------------------------------------------
      // 4. get_hours_left
      // ---------------------------------------------------------
      case 'get_hours_left': {
        const args = GetHoursLeftSchema.parse(rawArgs);
        let query = `
          SELECT h.subject_code, h.subject_name, sec.section_label, h.staff_name, h.required_hours, h.delivered_hours, h.shortfall_hours, h.makeup_approved_hours
          FROM hours_summary h
          JOIN sections sec ON sec.section_id = h.section_id
          WHERE 1=1
        `;
        const params: any[] = [];
        if (args.subject_code) {
          query += ' AND UPPER(h.subject_code) = UPPER(?)';
          params.push(args.subject_code);
        }
        if (args.section_id) {
          query += ' AND (sec.section_label = ? OR CAST(h.section_id AS TEXT) = ?)';
          params.push(args.section_id, args.section_id);
        }

        query += ' ORDER BY h.shortfall_hours DESC';
        const rows = db.prepare(query).all(...params);

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: {
            total_items: rows.length,
            hours: rows,
          },
        };
      }

      // ---------------------------------------------------------
      // 5. list_holidays
      // ---------------------------------------------------------
      case 'list_holidays': {
        const args = ListHolidaysSchema.parse(rawArgs);
        let query = 'SELECT holiday_id as id, date_from as date, name FROM holidays_clean WHERE 1=1';
        const params: any[] = [];
        if (args.start_date) {
          query += ' AND date_from >= ?';
          params.push(args.start_date);
        }
        if (args.end_date) {
          query += ' AND date_to <= ?';
          params.push(args.end_date);
        }
        query += ' ORDER BY date_from ASC';
        const rows = db.prepare(query).all(...params);

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: { count: rows.length, holidays: rows },
        };
      }

      // ---------------------------------------------------------
      // 6. list_events
      // ---------------------------------------------------------
      case 'list_events': {
        const args = ListEventsSchema.parse(rawArgs);
        let query = `
          SELECT id, name, date, start_period, end_period, venue_room_id
          FROM (
            SELECT event_id as id, event_name as name, date, start_period, end_period, venue_room_id FROM events
            UNION ALL
            SELECT id, 
                   json_extract(payload, '$.name') as name,
                   json_extract(payload, '$.date') as date,
                   json_extract(payload, '$.start_period') as start_period,
                   json_extract(payload, '$.end_period') as end_period,
                   json_extract(payload, '$.venue_room_id') as venue_room_id
            FROM changes
            WHERE type = 'event' AND status = 'applied'
          )
          WHERE 1=1
        `;
        const params: any[] = [];
        if (args.start_date) {
          query += ' AND date >= ?';
          params.push(args.start_date);
        }
        if (args.end_date) {
          query += ' AND date <= ?';
          params.push(args.end_date);
        }
        query += ' ORDER BY date ASC';
        const rows = db.prepare(query).all(...params);

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: { count: rows.length, events: rows },
        };
      }

      // ---------------------------------------------------------
      // 7. list_leave
      // ---------------------------------------------------------
      case 'list_leave': {
        const args = ListLeaveSchema.parse(rawArgs);
        let query = `
          SELECT id, staff_id, date_from, date_to, reason
          FROM (
            SELECT leave_id as id, staff_id, date_from, date_to, reason FROM leave
            UNION ALL
            SELECT id,
                   json_extract(payload, '$.staff_id') as staff_id,
                   json_extract(payload, '$.start_date') as date_from,
                   json_extract(payload, '$.end_date') as date_to,
                   json_extract(payload, '$.reason') as reason
            FROM changes
            WHERE type = 'leave' AND status = 'applied'
          )
          WHERE 1=1
        `;
        const params: any[] = [];

        if (role === 'staff') {
          query += ' AND staff_id = ?';
          params.push(userId);
        } else if (args.staff_id) {
          query += ' AND staff_id = ?';
          params.push(args.staff_id);
        }

        if (args.start_date) {
          query += ' AND date_to >= ?';
          params.push(args.start_date);
        }
        if (args.end_date) {
          query += ' AND date_from <= ?';
          params.push(args.end_date);
        }
        query += ' ORDER BY date_from ASC';
        const rows = db.prepare(query).all(...params);

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: { count: rows.length, leaves: rows },
        };
      }

      // ---------------------------------------------------------
      // 8. export_request
      // ---------------------------------------------------------
      case 'export_request': {
        const args = ExportRequestSchema.parse(rawArgs);
        const downloadUrl =
          args.kind === 'timetable'
            ? '/api/engine/export/timetable.csv'
            : '/api/engine/export/hours.csv';

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: {
            kind: args.kind,
            download_url: downloadUrl,
            message: `Export is ready. You can download the ${args.kind} CSV at ${downloadUrl}`,
          },
        };
      }

      // ---------------------------------------------------------
      // 9. preview_add_leave (Preview ONLY)
      // ---------------------------------------------------------
      case 'preview_add_leave': {
        const args = PreviewAddLeaveSchema.parse(rawArgs);
        if (role === 'staff' && args.staff_id !== userId) {
          logAudit(userId, role, toolName, args, 'denied', 'Staff tried to request leave for another member');
          return {
            success: false,
            tool: toolName,
            args,
            denied: true,
            message: 'Permission denied: You can only submit leave requests for yourself.',
          };
        }

        const preview = previewChange('leave', args, userId, false);
        logAudit(userId, role, toolName, args, 'success', { change_id: preview.change_id });
        return {
          success: true,
          tool: toolName,
          args,
          preview,
          message: 'Preview generated. Review the substitute teachers and affected sessions below. Click Confirm to apply.',
        };
      }

      // ---------------------------------------------------------
      // 10. preview_add_event (Preview ONLY)
      // ---------------------------------------------------------
      case 'preview_add_event': {
        const args = PreviewAddEventSchema.parse(rawArgs);
        const preview = previewChange('event', args, userId, false);
        logAudit(userId, role, toolName, args, 'success', { change_id: preview.change_id });
        return {
          success: true,
          tool: toolName,
          args,
          preview,
          message: 'Event preview generated. Shows displaced classes and room movements according to decision order. Click Confirm to apply.',
        };
      }

      // ---------------------------------------------------------
      // 11. preview_change_intake (Preview ONLY)
      // ---------------------------------------------------------
      case 'preview_change_intake': {
        const args = PreviewChangeIntakeSchema.parse(rawArgs);
        const preview = previewChange('intake', args, userId, false);
        logAudit(userId, role, toolName, args, 'success', { change_id: preview.change_id });
        return {
          success: true,
          tool: toolName,
          args,
          preview,
          message: 'Section intake change preview generated. Checks room capacity and sibling section balance. Click Confirm to apply.',
        };
      }

      // ---------------------------------------------------------
      // 12. preview_what_if (Hypothetical, cannot be confirmed)
      // ---------------------------------------------------------
      case 'preview_what_if': {
        const args = PreviewWhatIfSchema.parse(rawArgs);
        const preview = previewChange(args.type, args.payload, `${userId} (what-if)`, true);
        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          preview,
          isWhatIf: true,
          message: 'Hypothetical "What-if" analysis complete. Note: What-if scenarios are simulation only and cannot be confirmed.',
        };
      }

      // ---------------------------------------------------------
      // 13. suggest_substitutes
      // ---------------------------------------------------------
      case 'suggest_substitutes': {
        const args = SuggestSubstitutesSchema.parse(rawArgs);
        const preview = previewChange('leave', {
          staff_id: args.staff_id,
          start_date: args.start_date,
          end_date: args.end_date,
          reason: 'Substitute inquiry',
        }, userId, true);

        const substituteSuggestions = preview.impact_summary.proposed_fixes
          .filter((f) => f.action === 'substitute' || f.substitute_candidates?.length)
          .map((f) => ({
            session_id: f.session_id,
            subject_code: f.subject_code,
            date: f.original_date,
            period: f.original_period,
            chosen_substitute: f.substitute_staff_name,
            candidates: f.substitute_candidates,
          }));

        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: {
            staff_id: args.staff_id,
            start_date: args.start_date,
            end_date: args.end_date,
            sessions_count: substituteSuggestions.length,
            suggestions: substituteSuggestions,
          },
        };
      }

      // ---------------------------------------------------------
      // 14. insights
      // ---------------------------------------------------------
      case 'insights': {
        const args = InsightsSchema.parse(rawArgs);
        const insightsData: InsightsResult = computeTimetableInsights({
          utilizationThresholdPct: args.threshold_utilization,
          wastedSeatsMin: args.wasted_seats_min,
        });
        logAudit(userId, role, toolName, args, 'success');
        return {
          success: true,
          tool: toolName,
          args,
          result: insightsData,
        };
      }

      // ---------------------------------------------------------
      // 15. simulate_teacher_allocation (what-if unless stage=true; confirm is a separate HOD action)
      // ---------------------------------------------------------
      case 'simulate_teacher_allocation': {
        const args = SimulateTeacherAllocationSchema.parse(rawArgs);
        const stage = Boolean(args.stage);
        const { stage: _stage, ...payload } = args;
        const preview = previewChange('reallocation', payload, userId, !stage);
        logAudit(userId, role, toolName, args, 'success', { change_id: preview.change_id });
        return {
          success: true,
          tool: toolName,
          args,
          preview,
          isWhatIf: !stage,
          message: stage
            ? 'Reallocation preview staged. Review the student moves and click Confirm to apply (nothing has changed yet).'
            : 'Hypothetical reallocation computed. Nothing was changed.',
        };
      }

      default: {
        logAudit(userId, role, toolName, rawArgs, 'error', 'Unknown tool requested');
        return {
          success: false,
          tool: toolName,
          args: rawArgs,
          message: `Unknown tool "${toolName}". Please select an available system tool.`,
        };
      }
    }
  } catch (err: any) {
    logAudit(userId, role, toolName, rawArgs, 'error', err.message);
    return {
      success: false,
      tool: toolName,
      args: rawArgs,
      message: `Tool execution failed: ${err.message}`,
    };
  }
}
