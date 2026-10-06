import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
import { validateDatabaseCalendar } from '../engine/engineValidator.js';
/**
 * Computes a fingerprint token of the current timetable/calendar state to detect stale previews.
 */
export function getTimetableFingerprint() {
    const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM calendar_sessions) as c_count,
      (SELECT COUNT(*) FROM timetable_slots) as t_count,
      (SELECT MAX(session_id) FROM calendar_sessions) as max_c,
      (SELECT last_calendar_at FROM engine_state WHERE id = 1) as cal_at
  `).get();
    return `${row?.c_count || 0}_${row?.t_count || 0}_${row?.max_c || 0}_${row?.cal_at || ''}`;
}
/**
 * Previews a management change (leave, event, intake) without committing to the live schedule.
 * If isWhatIf is false, persists a record in `changes` with status 'previewed'.
 */
export function previewChange(type, payload, createdBy = 'HOD', isWhatIf = false) {
    const { rules } = getStoredRules();
    const workingDays = rules?.working_days || ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    const periodsPerDay = rules?.periods_per_day || 7;
    const maxStaffDaily = rules?.max_staff_periods_per_day || 4;
    const activeRooms = db.prepare(`SELECT * FROM rooms WHERE status = 'active' ORDER BY capacity ASC, room_id ASC`).all();
    const roomMap = new Map(activeRooms.map((r) => [r.room_id, r]));
    const staffList = db.prepare(`SELECT * FROM staff`).all();
    const staffMap = new Map(staffList.map((s) => [s.staff_id, s]));
    const currentFingerprint = getTimetableFingerprint();
    // Current shortfall summary
    const curHours = db.prepare(`SELECT subject_code, required_hours, delivered_hours, shortfall_hours FROM hours_summary`).all();
    const shortfallBefore = curHours.reduce((acc, h) => acc + (h.shortfall_hours || 0), 0);
    const bySubjectBeforeMap = new Map();
    curHours.forEach((h) => bySubjectBeforeMap.set(h.subject_code, (bySubjectBeforeMap.get(h.subject_code) || 0) + (h.shortfall_hours || 0)));
    const proposedFixes = [];
    const unresolvedItems = [];
    const diffItems = [];
    // Helper: check if room is free on date & period
    const isRoomFree = (roomId, date, period, excludeSessionId) => {
        let q = `
      SELECT COUNT(*) as c FROM calendar_sessions
      WHERE room_id = ? AND session_date = ? AND period = ? AND status IN ('scheduled', 'makeup')
    `;
        const params = [roomId, date, period];
        if (excludeSessionId) {
            q += ` AND session_id != ?`;
            params.push(excludeSessionId);
        }
        const res = db.prepare(q).get(...params);
        return (res?.c || 0) === 0;
    };
    // Helper: check if staff is free on date & period
    const isStaffFree = (staffId, date, period, excludeSessionId) => {
        // Check leave
        const leaveRow = db.prepare(`
      SELECT COUNT(*) as c FROM leave
      WHERE staff_id = ? AND status = 'approved' AND date_from <= ? AND date_to >= ?
    `).get(staffId, date, date);
        if ((leaveRow?.c || 0) > 0)
            return false;
        // Check calendar sessions
        let q = `
      SELECT COUNT(*) as c FROM calendar_sessions
      WHERE staff_id = ? AND session_date = ? AND period = ? AND status IN ('scheduled', 'makeup')
    `;
        const params = [staffId, date, period];
        if (excludeSessionId) {
            q += ` AND session_id != ?`;
            params.push(excludeSessionId);
        }
        const res = db.prepare(q).get(...params);
        return (res?.c || 0) === 0;
    };
    // Helper: check if section is free on date & period
    const isSectionFree = (sectionId, date, period, excludeSessionId) => {
        let q = `
      SELECT COUNT(*) as c FROM calendar_sessions
      WHERE section_id = ? AND session_date = ? AND period = ? AND status IN ('scheduled', 'makeup')
    `;
        const params = [sectionId, date, period];
        if (excludeSessionId) {
            q += ` AND session_id != ?`;
            params.push(excludeSessionId);
        }
        const res = db.prepare(q).get(...params);
        return (res?.c || 0) === 0;
    };
    // Helper: check staff daily teaching load on a date
    const getStaffDailyLoad = (staffId, date, excludeSessionId) => {
        let q = `
      SELECT COUNT(*) as c FROM calendar_sessions
      WHERE staff_id = ? AND session_date = ? AND status IN ('scheduled', 'makeup')
    `;
        const params = [staffId, date];
        if (excludeSessionId) {
            q += ` AND session_id != ?`;
            params.push(excludeSessionId);
        }
        const res = db.prepare(q).get(...params);
        return res?.c || 0;
    };
    // Helper: get staff total weekly load for a date's week
    const getStaffWeeklyLoad = (staffId, dateStr) => {
        const d = new Date(dateStr);
        const day = d.getDay() || 7;
        const monday = new Date(d);
        monday.setDate(d.getDate() - (day - 1));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const mStr = monday.toISOString().substring(0, 10);
        const sStr = sunday.toISOString().substring(0, 10);
        const res = db.prepare(`
      SELECT COUNT(*) as c FROM calendar_sessions
      WHERE staff_id = ? AND session_date >= ? AND session_date <= ? AND status IN ('scheduled', 'makeup')
    `).get(staffId, mStr, sStr);
        return res?.c || 0;
    };
    // Helper: check room suitability
    const isRoomSuitable = (room, size, requiredRoomType) => {
        if (room.capacity < size)
            return false;
        if (requiredRoomType === 'computer_lab') {
            return room.room_type === 'computer_lab';
        }
        return ['classroom', 'seminar_hall', 'auditorium'].includes(room.room_type);
    };
    // =========================================================================
    // TYPE 1: STAFF LEAVE
    // =========================================================================
    if (type === 'leave') {
        const { staff_id, start_date, end_date, periods, reason } = payload;
        if (!staff_id || !start_date || !end_date) {
            throw new Error('Leave requires staff_id, start_date, and end_date.');
        }
        let q = `
      SELECT c.*, s.section_label, s.size, s.required_room_type, s.is_lab, sub.subject_name
      FROM calendar_sessions c
      JOIN sections s ON c.section_id = s.section_id
      JOIN subjects sub ON c.subject_code = sub.subject_code
      WHERE c.staff_id = ? AND c.session_date >= ? AND c.session_date <= ?
        AND c.status IN ('scheduled', 'makeup')
    `;
        const params = [staff_id, start_date, end_date];
        if (Array.isArray(periods) && periods.length > 0) {
            q += ` AND c.period IN (${periods.map(() => '?').join(',')})`;
            params.push(...periods);
        }
        q += ` ORDER BY c.session_date ASC, c.period ASC`;
        const displacedSessions = db.prepare(q).all(...params);
        for (const sess of displacedSessions) {
            const subjCode = sess.subject_code;
            // Find qualified staff for this subject excluding the on-leave teacher
            const qualifiedRows = db.prepare(`
        SELECT staff_id FROM staff_subjects WHERE subject_code = ? AND staff_id != ?
      `).all(subjCode, staff_id);
            const candidates = [];
            for (const qRow of qualifiedRows) {
                const cStaffId = qRow.staff_id;
                const cStaff = staffMap.get(cStaffId);
                if (!cStaff)
                    continue;
                // Check if candidate is free at this slot
                if (!isStaffFree(cStaffId, sess.session_date, sess.period, sess.session_id)) {
                    continue;
                }
                // Check daily teaching limit
                const dailyLoad = getStaffDailyLoad(cStaffId, sess.session_date, sess.session_id);
                if (dailyLoad >= maxStaffDaily) {
                    continue;
                }
                // Check weekly teaching limit
                const maxTeaching = (cStaff.max_hours_per_week || 20) - (cStaff.hours_committed_elsewhere || 0);
                const weeklyLoad = getStaffWeeklyLoad(cStaffId, sess.session_date);
                if (weeklyLoad >= maxTeaching) {
                    continue;
                }
                candidates.push({
                    staff_id: cStaffId,
                    staff_name: cStaff.staff_name,
                    current_load: weeklyLoad,
                });
            }
            // Rank candidates by least load first, then staff_id
            candidates.sort((a, b) => a.current_load - b.current_load || a.staff_id.localeCompare(b.staff_id));
            if (candidates.length > 0) {
                const topSub = candidates[0];
                proposedFixes.push({
                    session_id: sess.session_id,
                    section_id: sess.section_id,
                    section_label: sess.section_label,
                    subject_code: sess.subject_code,
                    original_date: sess.session_date,
                    original_period: sess.period,
                    original_room_id: sess.room_id,
                    original_staff_id: sess.staff_id,
                    action: 'substitute',
                    substitute_staff_id: topSub.staff_id,
                    substitute_staff_name: topSub.staff_name,
                    substitute_candidates: candidates,
                    reason: `Faculty on leave: ${reason || 'Approved leave'}. Substitute suggested.`,
                });
                diffItems.push({
                    session_id: sess.session_id,
                    description: `${sess.section_label} (${sess.subject_code}) on ${sess.session_date} P${sess.period}`,
                    before: `Staff: ${staffMap.get(staff_id)?.staff_name || staff_id} (in ${sess.room_id})`,
                    after: `Substitute: ${topSub.staff_name} (${topSub.staff_id})`,
                });
            }
            else {
                // No substitute: propose make-up on later date
                let makeupFound = false;
                const curDate = new Date(sess.session_date);
                const semEnd = rules?.semester_end ? new Date(rules.semester_end) : new Date(curDate.getTime() + 60 * 86400000);
                const checkDate = new Date(curDate);
                checkDate.setDate(checkDate.getDate() + 1);
                while (checkDate <= semEnd && !makeupFound) {
                    const dayNum = checkDate.getDay();
                    // Monday=1 .. Friday=5 (or Saturday=6 if allowed)
                    const isWorkDay = (dayNum >= 1 && dayNum <= 5) || (dayNum === 6 && rules?.saturday_makeup_allowed);
                    if (isWorkDay) {
                        const dateStr = checkDate.toISOString().substring(0, 10);
                        for (let p = 1; p <= periodsPerDay; p++) {
                            if (isStaffFree(sess.staff_id, dateStr, p) &&
                                isSectionFree(sess.section_id, dateStr, p)) {
                                // Find suitable free room
                                const freeRoom = activeRooms.find((r) => isRoomSuitable(r, sess.size, sess.required_room_type) && isRoomFree(r.room_id, dateStr, p));
                                if (freeRoom) {
                                    proposedFixes.push({
                                        session_id: sess.session_id,
                                        section_id: sess.section_id,
                                        section_label: sess.section_label,
                                        subject_code: sess.subject_code,
                                        original_date: sess.session_date,
                                        original_period: sess.period,
                                        original_room_id: sess.room_id,
                                        original_staff_id: sess.staff_id,
                                        action: 'makeup',
                                        makeup_date: dateStr,
                                        makeup_period: p,
                                        makeup_room_id: freeRoom.room_id,
                                        reason: `No substitute available; proposed make-up on ${dateStr} P${p}`,
                                    });
                                    diffItems.push({
                                        session_id: sess.session_id,
                                        description: `${sess.section_label} on ${sess.session_date} P${sess.period}`,
                                        before: `Scheduled on ${sess.session_date} P${sess.period} by ${sess.staff_id}`,
                                        after: `Skipped (leave) & Make-up proposed on ${dateStr} P${p} in ${freeRoom.room_id}`,
                                    });
                                    makeupFound = true;
                                    break;
                                }
                            }
                        }
                    }
                    checkDate.setDate(checkDate.getDate() + 1);
                }
                if (!makeupFound) {
                    proposedFixes.push({
                        session_id: sess.session_id,
                        section_id: sess.section_id,
                        section_label: sess.section_label,
                        subject_code: sess.subject_code,
                        original_date: sess.session_date,
                        original_period: sess.period,
                        original_room_id: sess.room_id,
                        original_staff_id: sess.staff_id,
                        action: 'manual',
                        reason: 'No qualified substitute available and no clash-free make-up slot could be found.',
                    });
                    unresolvedItems.push({
                        session_id: sess.session_id,
                        reason: `Session ${sess.section_label} on ${sess.session_date} P${sess.period} has no substitute and no make-up slot.`,
                    });
                }
            }
        }
    }
    // =========================================================================
    // TYPE 2: EVENT
    // =========================================================================
    else if (type === 'event') {
        const { name, date, date_from, date_to, start_period, end_period, venue_room_id, staff_involved, sections_involved, blocked_rooms, } = payload;
        const eventDateStart = date || date_from;
        const eventDateEnd = date || date_to || date_from;
        if (!name || !eventDateStart) {
            throw new Error('Event requires name and date.');
        }
        const startP = Number(start_period) || 1;
        const endP = Number(end_period) || periodsPerDay;
        const blockedRoomIds = new Set();
        if (venue_room_id)
            blockedRoomIds.add(venue_room_id);
        if (Array.isArray(blocked_rooms)) {
            blocked_rooms.forEach((r) => blockedRoomIds.add(r));
        }
        const staffInvolvedSet = new Set();
        if (Array.isArray(staff_involved)) {
            staff_involved.forEach((s) => staffInvolvedSet.add(s));
        }
        else if (typeof staff_involved === 'string') {
            staff_involved.split(';').map((s) => s.trim()).filter(Boolean).forEach((s) => staffInvolvedSet.add(s));
        }
        const sectionsInvolvedSet = new Set();
        const isAllStudents = sections_involved === 'ALL';
        if (Array.isArray(sections_involved)) {
            sections_involved.forEach((sec) => sectionsInvolvedSet.add(Number(sec)));
        }
        // Find all displaced sessions
        const queryStmt = db.prepare(`
      SELECT c.*, s.section_label, s.size, s.required_room_type, s.is_lab, sub.subject_name
      FROM calendar_sessions c
      JOIN sections s ON c.section_id = s.section_id
      JOIN subjects sub ON c.subject_code = sub.subject_code
      WHERE c.session_date >= ? AND c.session_date <= ?
        AND c.period >= ? AND c.period <= ?
        AND c.status IN ('scheduled', 'makeup')
      ORDER BY c.session_date ASC, c.period ASC
    `);
        const candidateSessions = queryStmt.all(eventDateStart, eventDateEnd, startP, endP);
        const displacedSessions = candidateSessions.filter((s) => {
            const roomBlocked = blockedRoomIds.has(s.room_id);
            const staffBlocked = staffInvolvedSet.has(s.staff_id);
            const sectionBlocked = isAllStudents || sectionsInvolvedSet.has(s.section_id);
            return roomBlocked || staffBlocked || sectionBlocked;
        });
        for (const sess of displacedSessions) {
            const isRoomIssue = blockedRoomIds.has(sess.room_id);
            const isStaffIssue = staffInvolvedSet.has(sess.staff_id);
            const isSectionIssue = isAllStudents || sectionsInvolvedSet.has(sess.section_id);
            let resolved = false;
            // DECISION ORDER 1: Another free room in SAME slot
            // Only applicable if staff and section are NOT blocked by the event!
            if (isRoomIssue && !isStaffIssue && !isSectionIssue) {
                const eligibleRooms = activeRooms.filter((r) => !blockedRoomIds.has(r.room_id) &&
                    isRoomSuitable(r, sess.size, sess.required_room_type) &&
                    isRoomFree(r.room_id, sess.session_date, sess.period, sess.session_id));
                if (eligibleRooms.length > 0) {
                    // Pick room with minimum wasted seats (breaking ties by room_id ASC)
                    eligibleRooms.sort((a, b) => a.capacity - sess.size - (b.capacity - sess.size) || a.room_id.localeCompare(b.room_id));
                    const chosenRoom = eligibleRooms[0];
                    proposedFixes.push({
                        session_id: sess.session_id,
                        section_id: sess.section_id,
                        section_label: sess.section_label,
                        subject_code: sess.subject_code,
                        original_date: sess.session_date,
                        original_period: sess.period,
                        original_room_id: sess.room_id,
                        original_staff_id: sess.staff_id,
                        action: 'move_room',
                        new_room_id: chosenRoom.room_id,
                        new_room_name: chosenRoom.room_name,
                        reason: `Event in ${sess.room_id}. Moved to free room ${chosenRoom.room_id} in same slot.`,
                    });
                    diffItems.push({
                        session_id: sess.session_id,
                        description: `${sess.section_label} on ${sess.session_date} P${sess.period}`,
                        before: `Room: ${sess.room_id} (occupied by event '${name}')`,
                        after: `Room: ${chosenRoom.room_id} (${chosenRoom.room_name})`,
                    });
                    resolved = true;
                }
            }
            // DECISION ORDER 2: Another free slot on the SAME day
            if (!resolved && !isSectionIssue) {
                for (let p = 1; p <= periodsPerDay; p++) {
                    if (p >= startP && p <= endP && (isStaffIssue || isSectionIssue)) {
                        continue; // period is blocked by event for staff/students
                    }
                    if (p !== sess.period &&
                        isStaffFree(sess.staff_id, sess.session_date, p, sess.session_id) &&
                        isSectionFree(sess.section_id, sess.session_date, p, sess.session_id)) {
                        const candidateRooms = activeRooms.filter((r) => (!blockedRoomIds.has(r.room_id) || p < startP || p > endP) &&
                            isRoomSuitable(r, sess.size, sess.required_room_type) &&
                            isRoomFree(r.room_id, sess.session_date, p, sess.session_id));
                        if (candidateRooms.length > 0) {
                            candidateRooms.sort((a, b) => a.capacity - sess.size - (b.capacity - sess.size) || a.room_id.localeCompare(b.room_id));
                            const chosenRoom = candidateRooms[0];
                            proposedFixes.push({
                                session_id: sess.session_id,
                                section_id: sess.section_id,
                                section_label: sess.section_label,
                                subject_code: sess.subject_code,
                                original_date: sess.session_date,
                                original_period: sess.period,
                                original_room_id: sess.room_id,
                                original_staff_id: sess.staff_id,
                                action: 'move_slot',
                                new_date: sess.session_date,
                                new_period: p,
                                new_room_id: chosenRoom.room_id,
                                new_room_name: chosenRoom.room_name,
                                reason: `Event clash at P${sess.period}. Moved to P${p} in ${chosenRoom.room_id} on same day.`,
                            });
                            diffItems.push({
                                session_id: sess.session_id,
                                description: `${sess.section_label} on ${sess.session_date}`,
                                before: `Period ${sess.period} in ${sess.room_id}`,
                                after: `Period ${p} in ${chosenRoom.room_id}`,
                            });
                            resolved = true;
                            break;
                        }
                    }
                }
            }
            // DECISION ORDER 3: Make-up on a later working day
            if (!resolved) {
                let makeupFound = false;
                const curDate = new Date(sess.session_date);
                const semEnd = rules?.semester_end ? new Date(rules.semester_end) : new Date(curDate.getTime() + 60 * 86400000);
                const checkDate = new Date(curDate);
                checkDate.setDate(checkDate.getDate() + 1);
                while (checkDate <= semEnd && !makeupFound) {
                    const dayNum = checkDate.getDay();
                    const isWorkDay = (dayNum >= 1 && dayNum <= 5) || (dayNum === 6 && rules?.saturday_makeup_allowed);
                    if (isWorkDay) {
                        const dateStr = checkDate.toISOString().substring(0, 10);
                        for (let p = 1; p <= periodsPerDay; p++) {
                            if (isStaffFree(sess.staff_id, dateStr, p) &&
                                isSectionFree(sess.section_id, dateStr, p)) {
                                const freeRoom = activeRooms.find((r) => isRoomSuitable(r, sess.size, sess.required_room_type) && isRoomFree(r.room_id, dateStr, p));
                                if (freeRoom) {
                                    proposedFixes.push({
                                        session_id: sess.session_id,
                                        section_id: sess.section_id,
                                        section_label: sess.section_label,
                                        subject_code: sess.subject_code,
                                        original_date: sess.session_date,
                                        original_period: sess.period,
                                        original_room_id: sess.room_id,
                                        original_staff_id: sess.staff_id,
                                        action: 'makeup',
                                        makeup_date: dateStr,
                                        makeup_period: p,
                                        makeup_room_id: freeRoom.room_id,
                                        reason: `Event clash. Displaced session will be made up on ${dateStr} P${p}`,
                                    });
                                    diffItems.push({
                                        session_id: sess.session_id,
                                        description: `${sess.section_label} on ${sess.session_date} P${sess.period}`,
                                        before: `Scheduled on ${sess.session_date} P${sess.period}`,
                                        after: `Displaced by event; Make-up proposed on ${dateStr} P${p} in ${freeRoom.room_id}`,
                                    });
                                    makeupFound = true;
                                    resolved = true;
                                    break;
                                }
                            }
                        }
                    }
                    checkDate.setDate(checkDate.getDate() + 1);
                }
            }
            // DECISION ORDER 4: Needs manual decision
            if (!resolved) {
                proposedFixes.push({
                    session_id: sess.session_id,
                    section_id: sess.section_id,
                    section_label: sess.section_label,
                    subject_code: sess.subject_code,
                    original_date: sess.session_date,
                    original_period: sess.period,
                    original_room_id: sess.room_id,
                    original_staff_id: sess.staff_id,
                    action: 'manual',
                    reason: `No alternative room in same slot, no free slot on same day, and no later make-up slot could be scheduled.`,
                });
                unresolvedItems.push({
                    session_id: sess.session_id,
                    reason: `Session ${sess.section_label} displaced by event '${name}' requires manual resolution.`,
                });
            }
        }
    }
    // =========================================================================
    // TYPE 3: INTAKE CHANGE
    // =========================================================================
    else if (type === 'intake') {
        const { section_id, new_size } = payload;
        if (!section_id || !new_size || typeof new_size !== 'number') {
            throw new Error('Intake change requires section_id and new_size.');
        }
        const sec = db.prepare(`
      SELECT s.*, sub.subject_name
      FROM sections s
      JOIN subjects sub ON s.subject_code = sub.subject_code
      WHERE s.section_id = ?
    `).get(section_id);
        if (!sec) {
            throw new Error(`Section ID ${section_id} not found.`);
        }
        const minSize = rules?.min_section_size ?? 30;
        const maxSize = rules?.max_section_size ?? 70;
        if (new_size < minSize) {
            unresolvedItems.push({
                session_id: 0,
                reason: `New size ${new_size} is below institutional minimum section size (${minSize}).`,
            });
        }
        else if (new_size > maxSize) {
            unresolvedItems.push({
                session_id: 0,
                reason: `New size ${new_size} exceeds institutional maximum section size (${maxSize}).`,
            });
        }
        // Check room capacity for the section's weekly slots
        const currentSlots = db.prepare(`
      SELECT t.*, r.capacity, r.room_name
      FROM timetable_slots t
      JOIN rooms r ON t.room_id = r.room_id
      WHERE t.section_id = ?
    `).all(section_id);
        let needsRoomMove = false;
        let targetRoom = null;
        for (const slot of currentSlots) {
            if (slot.capacity < new_size) {
                needsRoomMove = true;
                break;
            }
        }
        if (needsRoomMove) {
            // Find a bigger room that fits new_size and matches room_type
            const suitableRooms = activeRooms.filter((r) => isRoomSuitable(r, new_size, sec.required_room_type));
            if (suitableRooms.length === 0) {
                unresolvedItems.push({
                    session_id: 0,
                    reason: `No active room of type '${sec.required_room_type}' has capacity >= ${new_size}.`,
                });
            }
            else {
                // Find a room that is free during all of the section's weekly periods
                for (const candidate of suitableRooms) {
                    let allSlotsFree = true;
                    for (const slot of currentSlots) {
                        // Check if candidate room is free at this day and period in weekly timetable
                        const clash = db.prepare(`
              SELECT COUNT(*) as c FROM timetable_slots
              WHERE room_id = ? AND day_of_week = ? AND period = ? AND section_id != ?
            `).get(candidate.room_id, slot.day_of_week, slot.period, section_id);
                        if ((clash?.c || 0) > 0) {
                            allSlotsFree = false;
                            break;
                        }
                    }
                    if (allSlotsFree) {
                        targetRoom = candidate;
                        break;
                    }
                }
                if (!targetRoom) {
                    unresolvedItems.push({
                        session_id: 0,
                        reason: `Bigger rooms exist for size ${new_size}, but none are completely free across all weekly slots for section ${sec.section_label}.`,
                    });
                }
            }
        }
        diffItems.push({
            description: `Section ${sec.section_label} (${sec.subject_code}) Size`,
            before: `Size: ${sec.size} students`,
            after: `Size: ${new_size} students${targetRoom ? ` (Moved to ${targetRoom.room_id}, capacity ${targetRoom.capacity})` : ''}`,
        });
        if (targetRoom) {
            // Propose fix for all future calendar sessions of this section
            const futureSessions = db.prepare(`
        SELECT session_id, session_date, period, room_id, staff_id
        FROM calendar_sessions
        WHERE section_id = ? AND status IN ('scheduled', 'makeup')
      `).all(section_id);
            for (const fs of futureSessions) {
                proposedFixes.push({
                    session_id: fs.session_id,
                    section_id,
                    section_label: sec.section_label,
                    subject_code: sec.subject_code,
                    original_date: fs.session_date,
                    original_period: fs.period,
                    original_room_id: fs.room_id,
                    original_staff_id: fs.staff_id,
                    action: 'move_room',
                    new_room_id: targetRoom.room_id,
                    new_room_name: targetRoom.room_name,
                    reason: `Intake increased to ${new_size}. Moved to larger room ${targetRoom.room_id}.`,
                });
            }
        }
    }
    // Calculate projected shortfall after change
    // If an affected session is given a substitute or move_room or move_slot, hours delivered are preserved.
    // If it is make-up, hours will be preserved once approved, but technically shortfall increases until approved.
    // If manual, shortfall increases by 1.
    let shortfallAfter = shortfallBefore;
    const bySubjectAfterMap = new Map(bySubjectBeforeMap);
    for (const fix of proposedFixes) {
        if (fix.action === 'makeup' || fix.action === 'manual') {
            shortfallAfter++;
            bySubjectAfterMap.set(fix.subject_code, (bySubjectAfterMap.get(fix.subject_code) || 0) + 1);
        }
    }
    const bySubjectShortfall = Array.from(bySubjectAfterMap.entries()).map(([subject_code, after]) => ({
        subject_code,
        before: bySubjectBeforeMap.get(subject_code) || 0,
        after,
    }));
    const impactSummary = {
        sessions_affected_count: proposedFixes.length,
        proposed_fixes: proposedFixes,
        unresolved_items: unresolvedItems,
        shortfall_before: shortfallBefore,
        shortfall_after: shortfallAfter,
        by_subject_shortfall: bySubjectShortfall,
        new_clashes: 0,
        diff: diffItems,
    };
    if (isWhatIf) {
        return {
            change_id: null,
            type,
            payload,
            status: 'previewed',
            is_what_if: true,
            stale_token: currentFingerprint,
            impact_summary: impactSummary,
        };
    }
    // Insert preview record into changes table
    const insertStmt = db.prepare(`
    INSERT INTO changes (type, payload, status, created_by, created_at, impact_summary, stale_token)
    VALUES (?, ?, 'previewed', ?, ?, ?, ?)
  `);
    const now = new Date().toISOString();
    const res = insertStmt.run(type, JSON.stringify(payload), createdBy, now, JSON.stringify(impactSummary), currentFingerprint);
    const changeId = Number(res.lastInsertRowid);
    return {
        change_id: changeId,
        type,
        payload,
        status: 'previewed',
        is_what_if: false,
        stale_token: currentFingerprint,
        impact_summary: impactSummary,
    };
}
/**
 * Confirms and atomically applies a previewed change to calendar_sessions, timetable_slots,
 * and hours_summary, writing before/after state to management_change_log.
 */
export function confirmChange(changeId, confirmedBy = 'HOD') {
    const change = db.prepare(`SELECT * FROM changes WHERE id = ?`).get(changeId);
    if (!change) {
        throw new Error(`Change ID ${changeId} not found.`);
    }
    if (change.status !== 'previewed') {
        throw new Error(`Change ID ${changeId} cannot be confirmed because status is '${change.status}' (must be 'previewed').`);
    }
    // Stale preview verification
    const currentToken = getTimetableFingerprint();
    if (change.stale_token && change.stale_token !== currentToken) {
        throw new Error('Preview is stale. The timetable or calendar has changed since this preview was generated. Please generate a fresh preview before confirming.');
    }
    const payload = JSON.parse(change.payload);
    const impactSummary = JSON.parse(change.impact_summary || '{}');
    const proposedFixes = impactSummary.proposed_fixes || [];
    db.exec('BEGIN TRANSACTION;');
    try {
        // 1. Capture BEFORE state for affected sessions and records
        const sessionIds = proposedFixes.map((f) => f.session_id).filter(Boolean);
        let beforeSessions = [];
        if (sessionIds.length > 0) {
            beforeSessions = db.prepare(`
        SELECT * FROM calendar_sessions WHERE session_id IN (${sessionIds.map(() => '?').join(',')})
      `).all(...sessionIds);
        }
        let beforeSection = null;
        let beforeTimetableSlots = [];
        if (change.type === 'intake' && payload.section_id) {
            beforeSection = db.prepare(`SELECT * FROM sections WHERE section_id = ?`).get(payload.section_id);
            beforeTimetableSlots = db.prepare(`SELECT * FROM timetable_slots WHERE section_id = ?`).all(payload.section_id);
        }
        const beforeState = {
            type: change.type,
            payload,
            sessions: beforeSessions,
            section: beforeSection,
            timetable_slots: beforeTimetableSlots,
        };
        // 2. Apply proposed fixes
        for (const fix of proposedFixes) {
            if (fix.action === 'move_room' && fix.new_room_id) {
                db.prepare(`
          UPDATE calendar_sessions SET room_id = ? WHERE session_id = ?
        `).run(fix.new_room_id, fix.session_id);
            }
            else if (fix.action === 'move_slot' && fix.new_period && fix.new_room_id) {
                const dObj = new Date(fix.new_date || fix.original_date);
                const dayOfWeek = dObj.getDay() || 7;
                db.prepare(`
          UPDATE calendar_sessions SET
            session_date = ?,
            period = ?,
            room_id = ?,
            day_of_week = ?
          WHERE session_id = ?
        `).run(fix.new_date || fix.original_date, fix.new_period, fix.new_room_id, dayOfWeek, fix.session_id);
            }
            else if (fix.action === 'substitute' && fix.substitute_staff_id) {
                db.prepare(`
          UPDATE calendar_sessions SET
            staff_id = ?,
            notes = COALESCE(notes || '; ', '') || 'Substitute: ' || ?
          WHERE session_id = ?
        `).run(fix.substitute_staff_id, fix.substitute_staff_name || fix.substitute_staff_id, fix.session_id);
            }
            else if (fix.action === 'makeup' && fix.makeup_date && fix.makeup_period && fix.makeup_room_id) {
                // Mark displaced session as skipped
                const skipStatus = change.type === 'leave' ? 'skipped_leave' : 'skipped_event';
                db.prepare(`
          UPDATE calendar_sessions SET
            status = ?,
            notes = COALESCE(notes || '; ', '') || ?
          WHERE session_id = ?
        `).run(skipStatus, fix.reason || 'Displaced by schedule change', fix.session_id);
                // Add suggested make-up
                db.prepare(`
          INSERT INTO suggested_makeups (section_id, subject_code, staff_id, room_id, makeup_date, period, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'suggested', datetime('now'))
        `).run(fix.section_id, fix.subject_code, fix.original_staff_id, fix.makeup_room_id, fix.makeup_date, fix.makeup_period);
            }
            else if (fix.action === 'manual') {
                const skipStatus = change.type === 'leave' ? 'skipped_leave' : 'skipped_event';
                db.prepare(`
          UPDATE calendar_sessions SET
            status = ?,
            notes = COALESCE(notes || '; ', '') || ?
          WHERE session_id = ?
        `).run(skipStatus, fix.reason || 'Needs manual decision', fix.session_id);
            }
        }
        // 3. Apply intake changes if type === 'intake'
        if (change.type === 'intake') {
            const { section_id, new_size } = payload;
            db.prepare(`UPDATE sections SET size = ? WHERE section_id = ?`).run(new_size, section_id);
            const roomMove = proposedFixes.find((f) => f.action === 'move_room' && f.new_room_id);
            if (roomMove && roomMove.new_room_id) {
                db.prepare(`UPDATE timetable_slots SET room_id = ? WHERE section_id = ?`).run(roomMove.new_room_id, section_id);
            }
        }
        // 4. Record leave in leave table if type === 'leave'
        if (change.type === 'leave') {
            const { staff_id, start_date, end_date, reason } = payload;
            const leaveId = `LEV-CHG-${changeId}`;
            db.prepare(`
        INSERT OR REPLACE INTO leave (leave_id, staff_id, date_from, date_to, leave_type, reason, status, created_at)
        VALUES (?, ?, ?, ?, 'casual', ?, 'approved', datetime('now'))
      `).run(leaveId, staff_id, start_date, end_date, reason || 'Staff Leave Change');
        }
        // 5. Record event in events table if type === 'event'
        if (change.type === 'event') {
            const { name, date, date_from, start_period, end_period, venue_room_id, staff_involved, student_scope } = payload;
            const evtId = `EVT-CHG-${changeId}`;
            const eDate = date || date_from;
            const staffStr = Array.isArray(staff_involved) ? staff_involved.join(';') : (staff_involved || '');
            db.prepare(`
        INSERT OR REPLACE INTO events (
          event_id, event_name, event_type, date, start_period, end_period, venue_room_id, staff_involved, student_scope, expected_attendance, created_at
        ) VALUES (?, ?, 'Special Event', ?, ?, ?, ?, ?, ?, 100, datetime('now'))
      `).run(evtId, name, eDate, Number(start_period) || 1, Number(end_period) || 7, venue_room_id || 'AUD-1', staffStr, student_scope || 'PARTIAL');
        }
        // 6. Recalculate hours_summary
        const sections = db.prepare(`SELECT section_id FROM sections`).all();
        for (const sec of sections) {
            const deliveredCount = db.prepare(`
        SELECT COUNT(*) as c FROM calendar_sessions
        WHERE section_id = ? AND status IN ('scheduled', 'makeup')
      `).get(sec.section_id)?.c || 0;
            db.prepare(`
        UPDATE hours_summary SET
          delivered_hours = ?,
          shortfall_hours = MAX(0, required_hours - ?)
        WHERE section_id = ?
      `).run(deliveredCount, deliveredCount, sec.section_id);
        }
        // 7. Run independent calendar clash validator
        const validatorReport = validateDatabaseCalendar();
        if (!validatorReport.valid) {
            throw new Error(`Independent clash validator failed: ${validatorReport.errors.join('; ')}`);
        }
        // 8. Capture AFTER state
        let afterSessions = [];
        if (sessionIds.length > 0) {
            afterSessions = db.prepare(`
        SELECT * FROM calendar_sessions WHERE session_id IN (${sessionIds.map(() => '?').join(',')})
      `).all(...sessionIds);
        }
        const afterState = {
            type: change.type,
            payload,
            sessions: afterSessions,
        };
        // 9. Write to management_change_log
        const now = new Date().toISOString();
        db.prepare(`
      INSERT INTO management_change_log (change_id, changed_by, action, before_state, after_state, created_at)
      VALUES (?, ?, 'apply', ?, ?, ?)
    `).run(changeId, confirmedBy, JSON.stringify(beforeState), JSON.stringify(afterState), now);
        // 10. Update change status to applied
        db.prepare(`
      UPDATE changes SET status = 'applied', applied_at = ? WHERE id = ?
    `).run(now, changeId);
        // 11. Update engine_state to reflect calendar change
        db.prepare(`UPDATE engine_state SET last_calendar_at = ? WHERE id = 1`).run(now);
        db.exec('COMMIT;');
        return {
            success: true,
            message: `Change ${changeId} applied successfully.`,
            change_id: changeId,
        };
    }
    catch (err) {
        db.exec('ROLLBACK;');
        throw new Error(`Failed to confirm change: ${err.message}`);
    }
}
/**
 * Discards a previewed change.
 */
export function discardChange(changeId) {
    const change = db.prepare(`SELECT * FROM changes WHERE id = ?`).get(changeId);
    if (!change) {
        throw new Error(`Change ID ${changeId} not found.`);
    }
    if (change.status === 'applied') {
        throw new Error(`Cannot discard an applied change. Use revert instead.`);
    }
    db.prepare(`UPDATE changes SET status = 'discarded' WHERE id = ?`).run(changeId);
    return { success: true, message: `Change ${changeId} discarded.` };
}
/**
 * Reverts an applied change, restoring exact prior state from management_change_log.
 */
export function revertChange(changeId, revertedBy = 'HOD') {
    const change = db.prepare(`SELECT * FROM changes WHERE id = ?`).get(changeId);
    if (!change) {
        throw new Error(`Change ID ${changeId} not found.`);
    }
    if (change.status !== 'applied') {
        throw new Error(`Change ID ${changeId} cannot be reverted because status is '${change.status}' (must be 'applied').`);
    }
    // Get latest apply log entry
    const logEntry = db.prepare(`
    SELECT * FROM management_change_log
    WHERE change_id = ? AND action = 'apply'
    ORDER BY id DESC LIMIT 1
  `).get(changeId);
    if (!logEntry) {
        throw new Error(`No before_state found in change log for change ${changeId}.`);
    }
    const beforeState = JSON.parse(logEntry.before_state);
    db.exec('BEGIN TRANSACTION;');
    try {
        // 1. Restore calendar_sessions
        if (Array.isArray(beforeState.sessions)) {
            for (const orig of beforeState.sessions) {
                db.prepare(`
          UPDATE calendar_sessions SET
            session_date = ?,
            period = ?,
            room_id = ?,
            staff_id = ?,
            status = ?,
            notes = ?,
            day_of_week = ?
          WHERE session_id = ?
        `).run(orig.session_date, orig.period, orig.room_id, orig.staff_id, orig.status, orig.notes, orig.day_of_week, orig.session_id);
            }
        }
        // 2. Restore section size if intake
        if (beforeState.section) {
            db.prepare(`UPDATE sections SET size = ? WHERE section_id = ?`).run(beforeState.section.size, beforeState.section.section_id);
        }
        // 3. Restore timetable slots if intake
        if (Array.isArray(beforeState.timetable_slots)) {
            for (const origSlot of beforeState.timetable_slots) {
                db.prepare(`UPDATE timetable_slots SET room_id = ? WHERE slot_id = ?`).run(origSlot.room_id, origSlot.slot_id);
            }
        }
        // 4. Remove any suggested_makeups created during apply
        if (change.type === 'leave') {
            const leaveId = `LEV-CHG-${changeId}`;
            db.prepare(`DELETE FROM leave WHERE leave_id = ?`).run(leaveId);
        }
        if (change.type === 'event') {
            const evtId = `EVT-CHG-${changeId}`;
            db.prepare(`DELETE FROM events WHERE event_id = ?`).run(evtId);
        }
        // 5. Recalculate hours_summary
        const sections = db.prepare(`SELECT section_id FROM sections`).all();
        for (const sec of sections) {
            const deliveredCount = db.prepare(`
        SELECT COUNT(*) as c FROM calendar_sessions
        WHERE section_id = ? AND status IN ('scheduled', 'makeup')
      `).get(sec.section_id)?.c || 0;
            db.prepare(`
        UPDATE hours_summary SET
          delivered_hours = ?,
          shortfall_hours = MAX(0, required_hours - ?)
        WHERE section_id = ?
      `).run(deliveredCount, deliveredCount, sec.section_id);
        }
        // 6. Validate calendar
        const valReport = validateDatabaseCalendar();
        if (!valReport.valid) {
            throw new Error(`Independent clash validator failed during revert: ${valReport.errors.join('; ')}`);
        }
        // 7. Write revert entry to management_change_log
        const now = new Date().toISOString();
        db.prepare(`
      INSERT INTO management_change_log (change_id, changed_by, action, before_state, after_state, created_at)
      VALUES (?, ?, 'revert', ?, ?, ?)
    `).run(changeId, revertedBy, JSON.stringify(logEntry.after_state), JSON.stringify(beforeState), now);
        // 8. Update change status to reverted
        db.prepare(`UPDATE changes SET status = 'reverted' WHERE id = ?`).run(changeId);
        // 9. Update engine_state
        db.prepare(`UPDATE engine_state SET last_calendar_at = ? WHERE id = 1`).run(now);
        db.exec('COMMIT;');
        return {
            success: true,
            message: `Change ${changeId} reverted successfully.`,
            change_id: changeId,
        };
    }
    catch (err) {
        db.exec('ROLLBACK;');
        throw new Error(`Failed to revert change: ${err.message}`);
    }
}
/**
 * Returns all changes with optional status/type filter.
 */
export function getChanges(filters = {}) {
    let q = `SELECT * FROM changes WHERE 1=1`;
    const params = [];
    if (filters.status) {
        q += ` AND status = ?`;
        params.push(filters.status);
    }
    if (filters.type) {
        q += ` AND type = ?`;
        params.push(filters.type);
    }
    q += ` ORDER BY id DESC`;
    const rows = db.prepare(q).all(...params);
    return rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: JSON.parse(r.payload || '{}'),
        status: r.status,
        created_by: r.created_by,
        created_at: r.created_at,
        applied_at: r.applied_at,
        impact_summary: r.impact_summary ? JSON.parse(r.impact_summary) : null,
        stale_token: r.stale_token,
    }));
}
/**
 * Returns a change by ID.
 */
export function getChangeById(changeId) {
    const row = db.prepare(`SELECT * FROM changes WHERE id = ?`).get(changeId);
    if (!row)
        return null;
    return {
        id: row.id,
        type: row.type,
        payload: JSON.parse(row.payload || '{}'),
        status: row.status,
        created_by: row.created_by,
        created_at: row.created_at,
        applied_at: row.applied_at,
        impact_summary: row.impact_summary ? JSON.parse(row.impact_summary) : null,
        stale_token: row.stale_token,
    };
}
/**
 * Returns management change history log.
 */
export function getChangeHistory(changeId) {
    let q = `
    SELECT l.*, c.type, c.payload
    FROM management_change_log l
    JOIN changes c ON l.change_id = c.id
    WHERE 1=1
  `;
    const params = [];
    if (changeId) {
        q += ` AND l.change_id = ?`;
        params.push(changeId);
    }
    q += ` ORDER BY l.id DESC`;
    const rows = db.prepare(q).all(...params);
    return rows.map((r) => ({
        id: r.id,
        change_id: r.change_id,
        type: r.type,
        changed_by: r.changed_by,
        action: r.action,
        before_state: JSON.parse(r.before_state || '{}'),
        after_state: JSON.parse(r.after_state || '{}'),
        created_at: r.created_at,
    }));
}
/**
 * Returns active alerts: unresolved items and course shortfall warnings.
 */
export function getManagementAlerts() {
    // 1. Unresolved items from recent applied changes
    const recentChanges = db.prepare(`
    SELECT id, type, impact_summary
    FROM changes
    WHERE status = 'applied'
    ORDER BY id DESC LIMIT 10
  `).all();
    const unresolved = [];
    for (const c of recentChanges) {
        if (c.impact_summary) {
            try {
                const sum = JSON.parse(c.impact_summary);
                if (Array.isArray(sum.unresolved_items)) {
                    sum.unresolved_items.forEach((item) => {
                        unresolved.push({ change_id: c.id, type: c.type, reason: item.reason });
                    });
                }
            }
            catch {
                // ignore
            }
        }
    }
    // 2. Shortfalls from hours_summary
    const shortfalls = db.prepare(`
    SELECT h.section_id, s.section_label, h.subject_code, h.shortfall_hours
    FROM hours_summary h
    JOIN sections s ON h.section_id = s.section_id
    WHERE h.shortfall_hours > 0
    ORDER BY h.shortfall_hours DESC
  `).all();
    return {
        total_alerts: unresolved.length + shortfalls.length,
        unresolved_items: unresolved,
        shortfall_items: shortfalls,
    };
}
