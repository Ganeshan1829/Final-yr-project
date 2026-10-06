import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
import { validateDatabaseTimetable, validateDatabaseCalendar } from '../engine/engineValidator.js';
import { getTimetableFingerprint } from '../changes/changesService.js';
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute max, but invalidated immediately on fingerprint change
function getCached(key, currentFingerprint) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (entry.fingerprint !== currentFingerprint) {
        cache.delete(key);
        return null;
    }
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}
function setCached(key, currentFingerprint, data) {
    cache.set(key, {
        fingerprint: currentFingerprint,
        timestamp: Date.now(),
        data,
    });
}
/**
 * 1. Summary KPIs
 */
export function getDashboardSummary(filters = {}) {
    const fingerprint = getTimetableFingerprint();
    const cacheKey = `summary_${JSON.stringify(filters)}`;
    const cached = getCached(cacheKey, fingerprint);
    if (cached)
        return cached;
    const { rules } = getStoredRules();
    const semesterDates = rules
        ? {
            semester_name: rules.semester_name || 'Academic Term',
            semester_start: rules.semester_start || '',
            semester_end: rules.semester_end || '',
        }
        : null;
    // Stale detection
    const engineState = db.prepare(`SELECT * FROM engine_state WHERE id = 1`).get();
    const lastSolverRun = db.prepare(`SELECT * FROM solver_runs WHERE status IN ('optimal', 'feasible') ORDER BY id DESC LIMIT 1`).get();
    const slotCountRow = db.prepare(`SELECT COUNT(*) as c FROM timetable_slots`).get();
    const slotCount = slotCountRow?.c || 0;
    let timetableStatus = 'not_generated';
    let isStale = false;
    let staleReason;
    if (slotCount === 0) {
        timetableStatus = 'not_generated';
    }
    else if (engineState?.stale === 1) {
        timetableStatus = 'stale';
        isStale = true;
        staleReason = 'Input datasets or rules were updated after generation';
    }
    else {
        timetableStatus = 'generated';
    }
    // Total sections
    let sectionQuery = `SELECT COUNT(*) as c FROM sections s JOIN subjects sub ON s.subject_code = sub.subject_code WHERE 1=1`;
    const secParams = [];
    if (filters.department) {
        sectionQuery += ` AND sub.department = ?`;
        secParams.push(filters.department);
    }
    if (filters.subject) {
        sectionQuery += ` AND (sub.subject_code = ? OR sub.subject_name LIKE ?)`;
        secParams.push(filters.subject, `%${filters.subject}%`);
    }
    if (filters.staff) {
        sectionQuery += ` AND s.staff_id = ?`;
        secParams.push(filters.staff);
    }
    const totalSections = db.prepare(sectionQuery).get(...secParams)?.c || 0;
    // Total weekly periods scheduled
    let slotQuery = `
    SELECT COUNT(*) as c
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN subjects sub ON s.subject_code = sub.subject_code
    WHERE 1=1
  `;
    const slotParams = [];
    if (filters.department) {
        slotQuery += ` AND sub.department = ?`;
        slotParams.push(filters.department);
    }
    if (filters.subject) {
        slotQuery += ` AND sub.subject_code = ?`;
        slotParams.push(filters.subject);
    }
    if (filters.staff) {
        slotQuery += ` AND s.staff_id = ?`;
        slotParams.push(filters.staff);
    }
    const totalWeeklyPeriods = db.prepare(slotQuery).get(...slotParams)?.c || 0;
    // Independent Clash check
    let totalClashes = 0;
    if (slotCount > 0) {
        const ttReport = validateDatabaseTimetable();
        totalClashes =
            ttReport.staff_clashes +
                ttReport.room_clashes +
                ttReport.section_clashes +
                ttReport.student_clashes +
                ttReport.capacity_violations +
                ttReport.room_type_violations +
                ttReport.hour_mismatches +
                ttReport.lab_block_violations;
        const calReport = validateDatabaseCalendar();
        totalClashes +=
            calReport.staff_clashes +
                calReport.room_clashes +
                calReport.section_clashes +
                calReport.capacity_violations;
    }
    // Total shortfall hours from hours_summary
    let shortfallQuery = `
    SELECT SUM(h.shortfall_hours) as s, SUM(h.makeup_approved_hours) as m
    FROM hours_summary h
    JOIN subjects sub ON h.subject_code = sub.subject_code
    WHERE 1=1
  `;
    const shortfallParams = [];
    if (filters.department) {
        shortfallQuery += ` AND sub.department = ?`;
        shortfallParams.push(filters.department);
    }
    if (filters.subject) {
        shortfallQuery += ` AND h.subject_code = ?`;
        shortfallParams.push(filters.subject);
    }
    if (filters.staff) {
        shortfallQuery += ` AND h.staff_id = ?`;
        shortfallParams.push(filters.staff);
    }
    const shortfallRow = db.prepare(shortfallQuery).get(...shortfallParams);
    const rawShortfall = shortfallRow?.s || 0;
    const makeupApproved = shortfallRow?.m || 0;
    const totalShortfall = Math.max(0, rawShortfall - makeupApproved);
    // Changes applied count
    let appliedChanges = 0;
    try {
        const chgRow = db.prepare(`SELECT COUNT(*) as c FROM changes WHERE status = 'applied'`).get();
        appliedChanges += chgRow?.c || 0;
    }
    catch { }
    try {
        const legacyChg = db.prepare(`SELECT COUNT(*) as c FROM change_log`).get();
        appliedChanges += legacyChg?.c || 0;
    }
    catch { }
    const result = {
        timetable_status: timetableStatus,
        semester_dates: semesterDates,
        total_sections: totalSections,
        total_weekly_periods: totalWeeklyPeriods,
        total_clashes: totalClashes,
        total_hours_shortfall: totalShortfall,
        changes_applied_count: appliedChanges,
        last_solver_run_time: lastSolverRun?.created_at || engineState?.last_solve_at || null,
        solver_run_id: lastSolverRun?.id || null,
        is_stale: isStale,
        stale_reason: staleReason,
    };
    setCached(cacheKey, fingerprint, result);
    return result;
}
/**
 * 2. Room Use (Utilization, Heatmap, Wasted Seats, Breakdown)
 */
export function getRoomUse(filters = {}, underusedThreshold = 30, overloadedThreshold = 85) {
    const fingerprint = getTimetableFingerprint();
    const cacheKey = `room_use_${JSON.stringify(filters)}_${underusedThreshold}_${overloadedThreshold}`;
    const cached = getCached(cacheKey, fingerprint);
    if (cached)
        return cached;
    const { rules } = getStoredRules();
    const workingDays = rules?.working_days || ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    const periodsPerDay = rules?.periods_per_day || 7;
    const availablePeriodsPerWeek = workingDays.length * periodsPerDay;
    // Active rooms
    const roomsRaw = db.prepare(`SELECT * FROM rooms WHERE status = 'active' ORDER BY room_type ASC, room_id ASC`).all();
    // Fetch all timetable slots with details
    const slotsRaw = db.prepare(`
    SELECT
      t.slot_id,
      t.section_id,
      t.room_id,
      t.day_of_week,
      t.period,
      t.is_lab_block,
      s.section_label,
      s.size as section_size,
      s.staff_id,
      sub.subject_code,
      sub.subject_name,
      sub.department,
      stf.staff_name,
      r.capacity as room_capacity,
      r.room_name
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN subjects sub ON s.subject_code = sub.subject_code
    LEFT JOIN staff stf ON s.staff_id = stf.staff_id
    JOIN rooms r ON t.room_id = r.room_id
    ORDER BY t.day_of_week ASC, t.period ASC
  `).all();
    // Map slots by room
    const roomSlotsMap = new Map();
    for (const slot of slotsRaw) {
        if (!roomSlotsMap.has(slot.room_id)) {
            roomSlotsMap.set(slot.room_id, []);
        }
        roomSlotsMap.get(slot.room_id).push(slot);
    }
    // Room Utilization list
    const roomsList = [];
    let underusedCount = 0;
    let overloadedCount = 0;
    let theoryPcts = [];
    let labPcts = [];
    for (const r of roomsRaw) {
        const slots = roomSlotsMap.get(r.room_id) || [];
        const usedPeriods = slots.length;
        const pct = availablePeriodsPerWeek > 0 ? Math.round((usedPeriods / availablePeriodsPerWeek) * 1000) / 10 : 0;
        let status = 'normal';
        if (pct < underusedThreshold) {
            status = 'underused';
            underusedCount++;
        }
        else if (pct > overloadedThreshold) {
            status = 'overloaded';
            overloadedCount++;
        }
        if (r.room_type === 'classroom' || r.room_type === 'seminar_hall') {
            theoryPcts.push(pct);
        }
        else {
            labPcts.push(pct);
        }
        roomsList.push({
            room_id: r.room_id,
            room_name: r.room_name,
            room_type: r.room_type,
            capacity: r.capacity,
            building: r.building,
            floor: r.floor,
            used_periods: usedPeriods,
            available_periods: availablePeriodsPerWeek,
            utilization_pct: pct,
            status,
        });
    }
    const theoryAvg = theoryPcts.length > 0 ? Math.round((theoryPcts.reduce((a, b) => a + b, 0) / theoryPcts.length) * 10) / 10 : 0;
    const labAvg = labPcts.length > 0 ? Math.round((labPcts.reduce((a, b) => a + b, 0) / labPcts.length) * 10) / 10 : 0;
    const overallAvg = roomsList.length > 0 ? Math.round((roomsList.reduce((acc, r) => acc + r.utilization_pct, 0) / roomsList.length) * 10) / 10 : 0;
    // Heatmap
    const heatmap = {
        days: workingDays,
        periods_per_day: periodsPerDay,
        rooms: roomsRaw.map((r) => {
            const slots = roomSlotsMap.get(r.room_id) || [];
            const slotMap = {};
            for (const s of slots) {
                slotMap[`${s.day_of_week}_${s.period}`] = {
                    occupied: true,
                    section_id: s.section_id,
                    section_label: s.section_label,
                    subject_code: s.subject_code,
                    subject_name: s.subject_name,
                    staff_id: s.staff_id,
                    staff_name: s.staff_name,
                    is_lab_block: Boolean(s.is_lab_block),
                };
            }
            return {
                room_id: r.room_id,
                room_name: r.room_name,
                room_type: r.room_type,
                capacity: r.capacity,
                slots: slotMap,
            };
        }),
    };
    // Wasted Seats
    let totalSeatPeriodsWasted = 0;
    const mismatches = [];
    for (const s of slotsRaw) {
        const wasted = Math.max(0, s.room_capacity - s.section_size);
        totalSeatPeriodsWasted += wasted;
        const wastedPct = s.room_capacity > 0 ? Math.round((wasted / s.room_capacity) * 1000) / 10 : 0;
        mismatches.push({
            day_of_week: s.day_of_week,
            period: s.period,
            room_id: s.room_id,
            room_name: s.room_name,
            room_capacity: s.room_capacity,
            section_id: s.section_id,
            section_label: s.section_label,
            subject_code: s.subject_code,
            subject_name: s.subject_name,
            section_size: s.section_size,
            wasted_seats: wasted,
            wasted_pct: wastedPct,
        });
    }
    mismatches.sort((a, b) => b.wasted_seats - a.wasted_seats);
    const worst10 = mismatches.slice(0, 10);
    const avgWasted = slotsRaw.length > 0 ? Math.round((totalSeatPeriodsWasted / slotsRaw.length) * 10) / 10 : 0;
    const result = {
        rooms: roomsList,
        heatmap,
        wasted_seats: {
            average_wasted_seats: avgWasted,
            total_seat_periods_wasted: totalSeatPeriodsWasted,
            worst_10_mismatches: worst10,
        },
        utilization_by_type: {
            theory_avg_pct: theoryAvg,
            lab_avg_pct: labAvg,
            overall_avg_pct: overallAvg,
        },
        underused_count: underusedCount,
        overloaded_count: overloadedCount,
    };
    setCached(cacheKey, fingerprint, result);
    return result;
}
/**
 * 3. Live Independent Clash Check
 */
export function getClashesAnalysis() {
    const fingerprint = getTimetableFingerprint();
    const cacheKey = 'clashes_analysis';
    const cached = getCached(cacheKey, fingerprint);
    if (cached)
        return cached;
    const ttReport = validateDatabaseTimetable();
    const calReport = validateDatabaseCalendar();
    const totalClashes = ttReport.staff_clashes +
        ttReport.room_clashes +
        ttReport.section_clashes +
        ttReport.student_clashes +
        ttReport.capacity_violations +
        ttReport.room_type_violations +
        ttReport.hour_mismatches +
        ttReport.lab_block_violations +
        calReport.staff_clashes +
        calReport.room_clashes +
        calReport.section_clashes +
        calReport.capacity_violations;
    const result = {
        total_clashes: totalClashes,
        status: totalClashes === 0 ? 'clean' : 'has_clashes',
        timetable_clashes: {
            staff_clashes: ttReport.staff_clashes,
            room_clashes: ttReport.room_clashes,
            section_clashes: ttReport.section_clashes,
            student_clashes: ttReport.student_clashes,
            capacity_violations: ttReport.capacity_violations,
            room_type_violations: ttReport.room_type_violations,
            hour_mismatches: ttReport.hour_mismatches,
            lab_block_violations: ttReport.lab_block_violations,
            errors: ttReport.errors,
        },
        calendar_clashes: {
            total_sessions: calReport.total_sessions,
            staff_clashes: calReport.staff_clashes,
            room_clashes: calReport.room_clashes,
            section_clashes: calReport.section_clashes,
            capacity_violations: calReport.capacity_violations,
            errors: calReport.errors,
        },
    };
    setCached(cacheKey, fingerprint, result);
    return result;
}
/**
 * 4. Hours Shortfalls & Department Breakdown
 */
export function getHoursAnalysis(filters = {}) {
    const fingerprint = getTimetableFingerprint();
    const cacheKey = `hours_analysis_${JSON.stringify(filters)}`;
    const cached = getCached(cacheKey, fingerprint);
    if (cached)
        return cached;
    let query = `
    SELECT
      h.section_id,
      h.subject_code,
      h.subject_name,
      h.staff_id,
      h.staff_name,
      h.required_hours,
      h.delivered_hours,
      h.shortfall_hours,
      h.makeup_approved_hours,
      s.section_label,
      sub.department
    FROM hours_summary h
    JOIN sections s ON h.section_id = s.section_id
    JOIN subjects sub ON h.subject_code = sub.subject_code
    WHERE 1=1
  `;
    const params = [];
    if (filters.department) {
        query += ` AND sub.department = ?`;
        params.push(filters.department);
    }
    if (filters.subject) {
        query += ` AND (h.subject_code = ? OR h.subject_name LIKE ?)`;
        params.push(filters.subject, `%${filters.subject}%`);
    }
    if (filters.staff) {
        query += ` AND (h.staff_id = ? OR h.staff_name LIKE ?)`;
        params.push(filters.staff, `%${filters.staff}%`);
    }
    query += ` ORDER BY h.shortfall_hours DESC, sub.department ASC, h.subject_code ASC`;
    const rows = db.prepare(query).all(...params);
    let totalRequired = 0;
    let totalDelivered = 0;
    let totalShortfall = 0;
    let totalApproved = 0;
    const deptMap = new Map();
    const subjects = [];
    for (const r of rows) {
        const finalShortfall = Math.max(0, r.shortfall_hours - (r.makeup_approved_hours || 0));
        const progressPct = r.required_hours > 0 ? Math.round((r.delivered_hours / r.required_hours) * 1000) / 10 : 0;
        totalRequired += r.required_hours;
        totalDelivered += r.delivered_hours;
        totalShortfall += r.shortfall_hours;
        totalApproved += r.makeup_approved_hours || 0;
        subjects.push({
            section_id: r.section_id,
            section_label: r.section_label || `SEC-${r.section_id}`,
            subject_code: r.subject_code,
            subject_name: r.subject_name,
            department: r.department || 'General',
            staff_id: r.staff_id,
            staff_name: r.staff_name,
            required_hours: r.required_hours,
            delivered_hours: r.delivered_hours,
            shortfall_hours: r.shortfall_hours,
            makeup_approved_hours: r.makeup_approved_hours || 0,
            final_shortfall: finalShortfall,
            progress_pct: progressPct,
        });
        const dept = r.department || 'General';
        if (!deptMap.has(dept)) {
            deptMap.set(dept, { req: 0, del: 0, short: 0, finalShort: 0 });
        }
        const d = deptMap.get(dept);
        d.req += r.required_hours;
        d.del += r.delivered_hours;
        d.short += r.shortfall_hours;
        d.finalShort += finalShortfall;
    }
    const departments = Array.from(deptMap.entries()).map(([department, data]) => ({
        department,
        required_hours: data.req,
        delivered_hours: data.del,
        shortfall_hours: data.short,
        final_shortfall: data.finalShort,
        completion_pct: data.req > 0 ? Math.round((data.del / data.req) * 1000) / 10 : 0,
    }));
    departments.sort((a, b) => b.shortfall_hours - a.shortfall_hours);
    // Make-up counts
    let makeupSuggested = 0;
    let makeupApprovedCount = 0;
    let makeupRejected = 0;
    try {
        const makeupRows = db.prepare(`SELECT status, COUNT(*) as c FROM suggested_makeups GROUP BY status`).all();
        for (const m of makeupRows) {
            if (m.status === 'suggested')
                makeupSuggested = m.c;
            else if (m.status === 'approved')
                makeupApprovedCount = m.c;
            else if (m.status === 'rejected')
                makeupRejected = m.c;
        }
    }
    catch { }
    const finalShortfallTotal = Math.max(0, totalShortfall - totalApproved);
    const overallCompletion = totalRequired > 0 ? Math.round((totalDelivered / totalRequired) * 1000) / 10 : 0;
    const result = {
        subjects,
        departments,
        makeup_status: {
            suggested_count: makeupSuggested,
            approved_count: makeupApprovedCount,
            rejected_count: makeupRejected,
            hours_recovered: makeupApprovedCount,
        },
        totals: {
            required_hours: totalRequired,
            delivered_hours: totalDelivered,
            shortfall_hours: totalShortfall,
            makeup_approved_hours: totalApproved,
            final_shortfall_hours: finalShortfallTotal,
            overall_completion_pct: overallCompletion,
        },
    };
    setCached(cacheKey, fingerprint, result);
    return result;
}
/**
 * 5. Staff Workload & Overload Flags
 */
export function getWorkloadAnalysis(filters = {}) {
    const fingerprint = getTimetableFingerprint();
    const cacheKey = `workload_analysis_${JSON.stringify(filters)}`;
    const cached = getCached(cacheKey, fingerprint);
    if (cached)
        return cached;
    let query = `
    SELECT
      stf.staff_id,
      stf.staff_name,
      stf.department,
      stf.max_hours_per_week,
      COUNT(t.slot_id) as scheduled_periods
    FROM staff stf
    LEFT JOIN sections s ON s.staff_id = stf.staff_id
    LEFT JOIN timetable_slots t ON t.section_id = s.section_id
    WHERE 1=1
  `;
    const params = [];
    if (filters.department) {
        query += ` AND stf.department = ?`;
        params.push(filters.department);
    }
    if (filters.staff) {
        query += ` AND (stf.staff_id = ? OR stf.staff_name LIKE ?)`;
        params.push(filters.staff, `%${filters.staff}%`);
    }
    query += ` GROUP BY stf.staff_id ORDER BY scheduled_periods DESC, stf.staff_name ASC`;
    const rows = db.prepare(query).all(...params);
    let overloadedCount = 0;
    let totalUtilPct = 0;
    const staffList = [];
    for (const r of rows) {
        const scheduled = r.scheduled_periods || 0;
        const maxAllowed = r.max_hours_per_week || 20;
        const isOverloaded = scheduled > maxAllowed;
        const utilPct = maxAllowed > 0 ? Math.round((scheduled / maxAllowed) * 1000) / 10 : 0;
        if (isOverloaded)
            overloadedCount++;
        totalUtilPct += utilPct;
        staffList.push({
            staff_id: r.staff_id,
            staff_name: r.staff_name,
            department: r.department || 'General',
            max_hours_per_week: maxAllowed,
            weekly_hours_scheduled: scheduled,
            is_overloaded: isOverloaded,
            utilization_pct: utilPct,
        });
    }
    const avgUtil = staffList.length > 0 ? Math.round((totalUtilPct / staffList.length) * 10) / 10 : 0;
    const result = {
        staff: staffList,
        overloaded_count: overloadedCount,
        average_utilization_pct: avgUtil,
    };
    setCached(cacheKey, fingerprint, result);
    return result;
}
/**
 * 6. Management Changes Analysis
 */
export function getChangesAnalysis() {
    const fingerprint = getTimetableFingerprint();
    const cacheKey = 'changes_analysis';
    const cached = getCached(cacheKey, fingerprint);
    if (cached)
        return cached;
    let leaveCount = 0;
    let eventCount = 0;
    let intakeCount = 0;
    let totalApplied = 0;
    const recentLog = [];
    try {
        const rows = db.prepare(`SELECT type, status, COUNT(*) as c FROM changes WHERE status = 'applied' GROUP BY type`).all();
        for (const r of rows) {
            if (r.type === 'leave')
                leaveCount = r.c;
            else if (r.type === 'event')
                eventCount = r.c;
            else if (r.type === 'intake')
                intakeCount = r.c;
        }
        totalApplied = leaveCount + eventCount + intakeCount;
        const recent = db.prepare(`SELECT id, type, created_at, created_by, status, impact_summary FROM changes ORDER BY id DESC LIMIT 5`).all();
        for (const r of recent) {
            let desc = `${r.type.toUpperCase()} change by ${r.created_by}`;
            try {
                const impact = JSON.parse(r.impact_summary || '{}');
                if (impact.summary)
                    desc = impact.summary;
            }
            catch { }
            recentLog.push({
                id: r.id,
                type: r.type,
                created_at: r.created_at,
                created_by: r.created_by,
                status: r.status,
                summary: desc,
            });
        }
    }
    catch { }
    // Fallback to legacy change_log if changes table is empty
    if (recentLog.length === 0) {
        try {
            const legacy = db.prepare(`SELECT * FROM change_log ORDER BY id DESC LIMIT 5`).all();
            for (const l of legacy) {
                recentLog.push({
                    id: l.id,
                    type: l.kind || 'generic',
                    created_at: l.created_at,
                    created_by: l.actor || 'Admin',
                    status: 'applied',
                    summary: l.detail_json || 'System modification',
                });
            }
            totalApplied = recentLog.length;
        }
        catch { }
    }
    const result = {
        leave_count: leaveCount,
        event_count: eventCount,
        intake_count: intakeCount,
        total_applied: totalApplied,
        recent_log: recentLog,
    };
    setCached(cacheKey, fingerprint, result);
    return result;
}
