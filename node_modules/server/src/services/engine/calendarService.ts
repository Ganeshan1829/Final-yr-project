import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';

export interface CalendarSessionRecord {
  session_id: number;
  section_id: number;
  section_label?: string;
  subject_code: string;
  subject_name?: string;
  staff_id: string;
  staff_name?: string;
  room_id: string;
  room_name?: string;
  session_date: string;
  day_of_week: number;
  period: number;
  status: 'scheduled' | 'skipped_holiday' | 'skipped_leave' | 'skipped_event' | 'makeup';
  notes: string | null;
}

export interface HoursSummaryRecord {
  id?: number;
  section_id: number;
  section_label: string;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  required_hours: number;
  delivered_hours: number;
  shortfall_hours: number;
  makeup_approved_hours: number;
}

export interface SuggestedMakeupRecord {
  id: number;
  section_id: number;
  section_label?: string;
  subject_code: string;
  subject_name?: string;
  staff_id: string;
  staff_name?: string;
  room_id: string;
  room_name?: string;
  makeup_date: string;
  period: number;
  status: 'suggested' | 'approved' | 'rejected';
  created_at: string;
}

export interface CalendarGenerationSummary {
  success: boolean;
  total_dates: number;
  total_sessions: number;
  scheduled_count: number;
  holiday_skipped_count: number;
  leave_skipped_count: number;
  event_skipped_count: number;
  makeups_suggested_count: number;
  total_shortfall_hours: number;
  hours_summary: HoursSummaryRecord[];
  makeups: SuggestedMakeupRecord[];
}

/**
 * Generates the full semester calendar by repeating the weekly timetable,
 * taking into account holidays, faculty leave, and university events.
 */
export function generateSemesterCalendar(): CalendarGenerationSummary {
  const { rules } = getStoredRules();
  if (!rules?.semester_start || !rules?.semester_end) {
    throw new Error('Semester start and end dates are not configured in academic rules.');
  }

  // 1. Fetch weekly timetable slots
  const slotsStmt = db.prepare(`
    SELECT
      t.slot_id,
      t.section_id,
      s.section_label,
      t.subject_code,
      sub.subject_name,
      sub.total_hours as sub_total_hours,
      s.hours_per_week,
      t.staff_id,
      stf.staff_name,
      t.room_id,
      r.room_name,
      t.day_of_week,
      t.period,
      t.is_lab_block,
      s.size,
      s.required_room_type
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN subjects sub ON t.subject_code = sub.subject_code
    JOIN staff stf ON t.staff_id = stf.staff_id
    JOIN rooms r ON t.room_id = r.room_id
    ORDER BY t.day_of_week ASC, t.period ASC
  `);
  const weeklySlots = slotsStmt.all() as any[];

  if (weeklySlots.length === 0) {
    throw new Error('No timetable slots found. Please run the Weekly Timetable Solver (Step 2) first.');
  }

  // 2. Fetch holidays
  const holidaysStmt = db.prepare(`
    SELECT holiday_id, name, date_from, date_to, ignored
    FROM holidays_clean
    WHERE ignored = 0
  `);
  const holidays = holidaysStmt.all() as any[];

  // 3. Fetch faculty leave
  const leaveStmt = db.prepare(`
    SELECT leave_id, staff_id, date_from, date_to, leave_type, reason, status
    FROM leave
    WHERE status = 'approved'
  `);
  const leaves = leaveStmt.all() as any[];

  // 4. Fetch university events
  const eventsStmt = db.prepare(`
    SELECT event_id, event_name, date, start_period, end_period, venue_room_id, staff_involved, student_scope
    FROM events
  `);
  const events = eventsStmt.all() as any[];

  // 5. Expand dates between semester_start and semester_end
  const startDate = new Date(rules.semester_start);
  const endDate = new Date(rules.semester_end);

  const dayMap: Record<number, number> = {
    1: 1, // Mon
    2: 2, // Tue
    3: 3, // Wed
    4: 4, // Thu
    5: 5, // Fri
    6: 6, // Sat
  };

  const plannedSessions: Array<{
    section_id: number;
    subject_code: string;
    staff_id: string;
    room_id: string;
    session_date: string;
    day_of_week: number;
    period: number;
    status: 'scheduled' | 'skipped_holiday' | 'skipped_leave' | 'skipped_event';
    notes: string | null;
  }> = [];

  let dateCursor = new Date(startDate);
  let totalDatesCount = 0;

  let scheduledCount = 0;
  let holidaySkippedCount = 0;
  let leaveSkippedCount = 0;
  let eventSkippedCount = 0;

  while (dateCursor <= endDate) {
    totalDatesCount++;
    const jsDay = dateCursor.getDay(); // 0=Sun, 1=Mon...6=Sat
    const dateStr = dateCursor.toISOString().slice(0, 10);

    if (jsDay >= 1 && jsDay <= 5) {
      const dayOfWeek = dayMap[jsDay];

      // Check if whole day is a holiday
      const holidayMatch = holidays.find((h) => dateStr >= h.date_from && dateStr <= h.date_to);

      // Find slots scheduled for this day of week
      const daySlots = weeklySlots.filter((s) => s.day_of_week === dayOfWeek);

      for (const slot of daySlots) {
        if (holidayMatch) {
          plannedSessions.push({
            section_id: slot.section_id,
            subject_code: slot.subject_code,
            staff_id: slot.staff_id,
            room_id: slot.room_id,
            session_date: dateStr,
            day_of_week: dayOfWeek,
            period: slot.period,
            status: 'skipped_holiday',
            notes: holidayMatch.name,
          });
          holidaySkippedCount++;
          continue;
        }

        // Check faculty leave
        const leaveMatch = leaves.find(
          (l) => l.staff_id === slot.staff_id && dateStr >= l.date_from && dateStr <= l.date_to
        );
        if (leaveMatch) {
          plannedSessions.push({
            section_id: slot.section_id,
            subject_code: slot.subject_code,
            staff_id: slot.staff_id,
            room_id: slot.room_id,
            session_date: dateStr,
            day_of_week: dayOfWeek,
            period: slot.period,
            status: 'skipped_leave',
            notes: `${leaveMatch.leave_type}: ${leaveMatch.reason}`,
          });
          leaveSkippedCount++;
          continue;
        }

        // Check event conflicts
        const eventMatch = events.find((e) => {
          if (e.date !== dateStr) return false;
          if (slot.period < e.start_period || slot.period > e.end_period) return false;
          const staffList = (e.staff_involved || '').split(';').map((s: string) => s.trim());
          if (e.venue_room_id === slot.room_id) return true;
          if (staffList.includes(slot.staff_id)) return true;
          if (e.student_scope === 'ALL') return true;
          return false;
        });

        if (eventMatch) {
          plannedSessions.push({
            section_id: slot.section_id,
            subject_code: slot.subject_code,
            staff_id: slot.staff_id,
            room_id: slot.room_id,
            session_date: dateStr,
            day_of_week: dayOfWeek,
            period: slot.period,
            status: 'skipped_event',
            notes: eventMatch.event_name,
          });
          eventSkippedCount++;
          continue;
        }

        // Otherwise scheduled successfully
        plannedSessions.push({
          section_id: slot.section_id,
          subject_code: slot.subject_code,
          staff_id: slot.staff_id,
          room_id: slot.room_id,
          session_date: dateStr,
          day_of_week: dayOfWeek,
          period: slot.period,
          status: 'scheduled',
          notes: null,
        });
        scheduledCount++;
      }
    }

    // Move to next calendar day
    dateCursor.setDate(dateCursor.getDate() + 1);
  }

  // 6. Persist calendar_sessions in atomic transaction
  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec(`
      DELETE FROM suggested_makeups;
      DELETE FROM calendar_sessions;
      DELETE FROM hours_summary;
    `);

    const insertSessionStmt = db.prepare(`
      INSERT INTO calendar_sessions (
        section_id, session_date, period, room_id, status, subject_code, staff_id, day_of_week, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const sess of plannedSessions) {
      insertSessionStmt.run(
        sess.section_id,
        sess.session_date,
        sess.period,
        sess.room_id,
        sess.status,
        sess.subject_code,
        sess.staff_id,
        sess.day_of_week,
        sess.notes
      );
    }

    // 7. Compute Hours Check Summary
    const teachingWeeksPlanned = rules.teaching_weeks_planned || 16;
    const sectionMap = new Map<number, any>();
    for (const s of weeklySlots) {
      if (!sectionMap.has(s.section_id)) {
        sectionMap.set(s.section_id, s);
      }
    }

    // Count delivered hours per section
    const deliveredCountBySec = new Map<number, number>();
    for (const sess of plannedSessions) {
      if (sess.status === 'scheduled') {
        deliveredCountBySec.set(sess.section_id, (deliveredCountBySec.get(sess.section_id) || 0) + 1);
      }
    }

    const hoursSummaryList: HoursSummaryRecord[] = [];
    const insertSummaryStmt = db.prepare(`
      INSERT INTO hours_summary (
        section_id, subject_code, subject_name, staff_id, staff_name,
        required_hours, delivered_hours, shortfall_hours, makeup_approved_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    let totalShortfall = 0;
    const sectionsWithShortfall: Array<{ section: any; shortfall: number }> = [];

    for (const [secId, s] of sectionMap.entries()) {
      const required = s.sub_total_hours || s.hours_per_week * teachingWeeksPlanned;
      const delivered = deliveredCountBySec.get(secId) || 0;
      const shortfall = Math.max(0, required - delivered);
      totalShortfall += shortfall;

      insertSummaryStmt.run(
        secId,
        s.subject_code,
        s.subject_name,
        s.staff_id,
        s.staff_name,
        required,
        delivered,
        shortfall
      );

      hoursSummaryList.push({
        section_id: secId,
        section_label: s.section_label,
        subject_code: s.subject_code,
        subject_name: s.subject_name,
        staff_id: s.staff_id,
        staff_name: s.staff_name,
        required_hours: required,
        delivered_hours: delivered,
        shortfall_hours: shortfall,
        makeup_approved_hours: 0,
      });

      if (shortfall > 0) {
        sectionsWithShortfall.push({ section: s, shortfall });
      }
    }

    // 8. Generate Make-up Suggestions
    // For each missing session, find free conflict-free slots on working days (or Saturdays if allowed)
    const suggestedMakeups: SuggestedMakeupRecord[] = [];
    const insertMakeupStmt = db.prepare(`
      INSERT INTO suggested_makeups (
        section_id, subject_code, staff_id, room_id, makeup_date, period, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?)
    `);

    // Build fast conflict lookup maps across the semester
    const busyRooms = new Set<string>(); // "date_period_room"
    const busyStaff = new Set<string>(); // "date_period_staff"
    const busySections = new Set<string>(); // "date_period_section"

    for (const sess of plannedSessions) {
      if (sess.status === 'scheduled') {
        busyRooms.add(`${sess.session_date}_${sess.period}_${sess.room_id}`);
        busyStaff.add(`${sess.session_date}_${sess.period}_${sess.staff_id}`);
        busySections.add(`${sess.session_date}_${sess.period}_${sess.section_id}`);
      }
    }

    const saturdayAllowed = Boolean(rules.saturday_makeup_allowed);
    const periodsPerDay = rules.periods_per_day || 7;
    const now = new Date().toISOString();

    for (const item of sectionsWithShortfall) {
      const s = item.section;
      let needed = item.shortfall;

      // Scan dates starting from 2 weeks into the semester to end of semester
      let searchCursor = new Date(startDate);
      searchCursor.setDate(searchCursor.getDate() + 14);

      while (searchCursor <= endDate && needed > 0) {
        const jsDay = searchCursor.getDay();
        const dateStr = searchCursor.toISOString().slice(0, 10);

        const isHoliday = holidays.some((h) => dateStr >= h.date_from && dateStr <= h.date_to);
        const isStaffOnLeave = leaves.some(
          (l) => l.staff_id === s.staff_id && dateStr >= l.date_from && dateStr <= l.date_to
        );

        if (!isHoliday && !isStaffOnLeave) {
          // Check if valid day (working day or Saturday if allowed)
          if ((jsDay >= 1 && jsDay <= 5) || (jsDay === 6 && saturdayAllowed)) {
            // Find a free period for this staff, room, and section
            for (let p = 1; p <= periodsPerDay; p++) {
              const rKey = `${dateStr}_${p}_${s.room_id}`;
              const stKey = `${dateStr}_${p}_${s.staff_id}`;
              const secKey = `${dateStr}_${p}_${s.section_id}`;

              if (!busyRooms.has(rKey) && !busyStaff.has(stKey) && !busySections.has(secKey)) {
                // Found a valid slot!
                busyRooms.add(rKey);
                busyStaff.add(stKey);
                busySections.add(secKey);

                const res = insertMakeupStmt.run(
                  s.section_id,
                  s.subject_code,
                  s.staff_id,
                  s.room_id,
                  dateStr,
                  p,
                  now
                );

                suggestedMakeups.push({
                  id: Number(res.lastInsertRowid),
                  section_id: s.section_id,
                  section_label: s.section_label,
                  subject_code: s.subject_code,
                  subject_name: s.subject_name,
                  staff_id: s.staff_id,
                  staff_name: s.staff_name,
                  room_id: s.room_id,
                  room_name: s.room_name,
                  makeup_date: dateStr,
                  period: p,
                  status: 'suggested',
                  created_at: now,
                });

                needed--;
                if (needed === 0) break;
              }
            }
          }
        }

        searchCursor.setDate(searchCursor.getDate() + 1);
      }
    }

    // Update engine state
    db.prepare(`
      UPDATE engine_state SET
        calendar_status = 'completed',
        stale = 0,
        last_calendar_at = ?
      WHERE id = 1
    `).run(now);

    db.exec('COMMIT;');

    return {
      success: true,
      total_dates: totalDatesCount,
      total_sessions: plannedSessions.length,
      scheduled_count: scheduledCount,
      holiday_skipped_count: holidaySkippedCount,
      leave_skipped_count: leaveSkippedCount,
      event_skipped_count: eventSkippedCount,
      makeups_suggested_count: suggestedMakeups.length,
      total_shortfall_hours: totalShortfall,
      hours_summary: hoursSummaryList,
      makeups: suggestedMakeups,
    };
  } catch (e: any) {
    db.exec('ROLLBACK;');
    throw new Error(`Failed to generate calendar: ${e.message}`);
  }
}

/**
 * Returns hours check summary.
 */
export function getHoursSummary(): HoursSummaryRecord[] {
  const stmt = db.prepare(`
    SELECT
      h.*,
      s.section_label
    FROM hours_summary h
    JOIN sections s ON h.section_id = s.section_id
    ORDER BY h.subject_code ASC, s.section_label ASC
  `);
  return stmt.all() as any[];
}

/**
 * Returns suggested make-ups.
 */
export function getMakeups(statusFilter?: string): SuggestedMakeupRecord[] {
  let query = `
    SELECT
      m.*,
      s.section_label,
      sub.subject_name,
      stf.staff_name,
      r.room_name
    FROM suggested_makeups m
    JOIN sections s ON m.section_id = s.section_id
    JOIN subjects sub ON m.subject_code = sub.subject_code
    JOIN staff stf ON m.staff_id = stf.staff_id
    JOIN rooms r ON m.room_id = r.room_id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (statusFilter) {
    query += ` AND m.status = ?`;
    params.push(statusFilter);
  }
  query += ` ORDER BY m.makeup_date ASC, m.period ASC`;

  const stmt = db.prepare(query);
  return stmt.all(...params) as any[];
}

/**
 * Approves a make-up session:
 * - Updates suggested_makeups status = 'approved'
 * - Inserts a session into calendar_sessions with status = 'makeup'
 * - Updates hours_summary (shortfall drops!)
 */
export function approveMakeup(makeupId: number): { success: boolean; message: string; makeup: any } {
  const stmt = db.prepare(`SELECT * FROM suggested_makeups WHERE id = ?`);
  const makeup = stmt.get(makeupId) as any;
  if (!makeup) {
    throw new Error(`Suggested makeup ID ${makeupId} not found`);
  }

  if (makeup.status === 'approved') {
    return { success: true, message: 'Make-up session already approved.', makeup };
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Update suggested_makeups
    db.prepare(`UPDATE suggested_makeups SET status = 'approved' WHERE id = ?`).run(makeupId);

    // 2. Insert into calendar_sessions
    db.prepare(`
      INSERT INTO calendar_sessions (
        section_id, session_date, period, room_id, status, subject_code, staff_id, day_of_week, notes
      ) VALUES (?, ?, ?, ?, 'makeup', ?, ?, ?, ?)
    `).run(
      makeup.section_id,
      makeup.makeup_date,
      makeup.period,
      makeup.room_id,
      makeup.subject_code,
      makeup.staff_id,
      new Date(makeup.makeup_date).getDay() || 6,
      'Approved make-up class'
    );

    // 3. Update hours_summary: increment makeup_approved_hours and decrement shortfall_hours
    db.prepare(`
      UPDATE hours_summary SET
        makeup_approved_hours = makeup_approved_hours + 1,
        shortfall_hours = MAX(0, shortfall_hours - 1)
      WHERE section_id = ?
    `).run(makeup.section_id);

    db.exec('COMMIT;');

    const updated = stmt.get(makeupId);
    return { success: true, message: 'Make-up class approved and added to semester calendar.', makeup: updated };
  } catch (e: any) {
    db.exec('ROLLBACK;');
    throw e;
  }
}

/**
 * Rejects a make-up session.
 */
export function rejectMakeup(makeupId: number): { success: boolean; message: string; makeup: any } {
  const stmt = db.prepare(`SELECT * FROM suggested_makeups WHERE id = ?`);
  const makeup = stmt.get(makeupId) as any;
  if (!makeup) {
    throw new Error(`Suggested makeup ID ${makeupId} not found`);
  }

  db.prepare(`UPDATE suggested_makeups SET status = 'rejected' WHERE id = ?`).run(makeupId);
  const updated = stmt.get(makeupId);
  return { success: true, message: 'Make-up class rejected.', makeup: updated };
}

/**
 * Returns calendar sessions with optional date/month/section filtering.
 */
export function getCalendarSessions(filters: {
  month?: string; // YYYY-MM
  date?: string; // YYYY-MM-DD
  section_id?: number;
  staff_id?: string;
  room_id?: string;
  status?: string;
} = {}): CalendarSessionRecord[] {
  let query = `
    SELECT
      c.*,
      s.section_label,
      sub.subject_name,
      stf.staff_name,
      r.room_name
    FROM calendar_sessions c
    JOIN sections s ON c.section_id = s.section_id
    JOIN subjects sub ON c.subject_code = sub.subject_code
    JOIN staff stf ON c.staff_id = stf.staff_id
    JOIN rooms r ON c.room_id = r.room_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.month) {
    query += ` AND c.session_date LIKE ?`;
    params.push(`${filters.month}%`);
  }
  if (filters.date) {
    query += ` AND c.session_date = ?`;
    params.push(filters.date);
  }
  if (filters.section_id) {
    query += ` AND c.section_id = ?`;
    params.push(filters.section_id);
  }
  if (filters.staff_id) {
    query += ` AND c.staff_id = ?`;
    params.push(filters.staff_id);
  }
  if (filters.room_id) {
    query += ` AND c.room_id = ?`;
    params.push(filters.room_id);
  }
  if (filters.status) {
    query += ` AND c.status = ?`;
    params.push(filters.status);
  }

  query += ` ORDER BY c.session_date ASC, c.period ASC`;

  const stmt = db.prepare(query);
  return stmt.all(...params) as any[];
}

/**
 * Alias for getMakeups with object filters
 */
export function getSuggestedMakeups(filters: { status?: string } = {}): SuggestedMakeupRecord[] {
  return getMakeups(filters.status);
}

/**
 * Updates makeup status to approved or rejected.
 */
export function updateMakeupStatus(
  makeupId: number,
  action: 'approve' | 'reject'
): { status: 'approved' | 'rejected'; makeup: any } {
  if (action === 'approve') {
    const res = approveMakeup(makeupId);
    return { status: 'approved', makeup: res.makeup };
  } else {
    const res = rejectMakeup(makeupId);
    return { status: 'rejected', makeup: res.makeup };
  }
}

/**
 * Exports weekly timetable as CSV string.
 */
export function exportTimetableCsv(): string {
  const stmt = db.prepare(`
    SELECT
      t.day_of_week,
      t.period,
      t.subject_code,
      sub.subject_name,
      s.section_label,
      stf.staff_name,
      t.room_id,
      r.room_name,
      t.is_lab_block
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN subjects sub ON t.subject_code = sub.subject_code
    JOIN staff stf ON t.staff_id = stf.staff_id
    JOIN rooms r ON t.room_id = r.room_id
    ORDER BY t.day_of_week ASC, t.period ASC
  `);
  const slots = stmt.all() as any[];
  const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let csv = 'day,period,start_time,end_time,subject_code,subject_name,section_label,staff_name,room_id,room_name,is_lab_block\n';
  for (const s of slots) {
    const dayStr = dayNames[s.day_of_week] || `Day ${s.day_of_week}`;
    const pStart = `08:${String(30 + (s.period - 1) * 55).padStart(2, '0')}`;
    const pEnd = `09:${String(20 + (s.period - 1) * 55).padStart(2, '0')}`;
    const line = [
      dayStr,
      s.period,
      pStart,
      pEnd,
      `"${s.subject_code}"`,
      `"${(s.subject_name || '').replace(/"/g, '""')}"`,
      `"${s.section_label}"`,
      `"${(s.staff_name || '').replace(/"/g, '""')}"`,
      `"${s.room_id}"`,
      `"${(s.room_name || '').replace(/"/g, '""')}"`,
      s.is_lab_block === 1 ? 'Yes' : 'No',
    ].join(',');
    csv += line + '\n';
  }
  return csv;
}

/**
 * Exports hours check summary as CSV string.
 */
export function exportHoursSummaryCsv(): string {
  const rows = getHoursSummary();
  let csv = 'section_label,subject_code,subject_name,staff_name,required_hours,delivered_hours,shortfall_hours,makeup_approved_hours\n';
  for (const r of rows) {
    const line = [
      `"${r.section_label}"`,
      `"${r.subject_code}"`,
      `"${(r.subject_name || '').replace(/"/g, '""')}"`,
      `"${(r.staff_name || '').replace(/"/g, '""')}"`,
      r.required_hours,
      r.delivered_hours,
      r.shortfall_hours,
      r.makeup_approved_hours,
    ].join(',');
    csv += line + '\n';
  }
  return csv;
}

