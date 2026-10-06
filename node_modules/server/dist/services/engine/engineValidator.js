import { db } from '../../db.js';
/**
 * Independent Validator:
 * Re-reads the solution directly from database tables, verifying all hard constraints
 * independently from the solver.
 */
export function validateDatabaseTimetable() {
    const errors = [];
    // 1. Fetch slots
    const slotsStmt = db.prepare(`
    SELECT
      t.slot_id,
      t.section_id,
      t.subject_code,
      t.staff_id,
      t.room_id,
      t.day_of_week,
      t.period,
      t.is_lab_block,
      s.size,
      s.is_lab,
      s.hours_per_week,
      r.capacity as room_capacity,
      r.room_type
    FROM timetable_slots t
    JOIN sections s ON t.section_id = s.section_id
    JOIN rooms r ON t.room_id = r.room_id
    ORDER BY t.day_of_week ASC, t.period ASC
  `);
    const slots = slotsStmt.all();
    if (slots.length === 0) {
        return {
            valid: false,
            total_slots: 0,
            staff_clashes: 0,
            room_clashes: 0,
            section_clashes: 0,
            student_clashes: 0,
            capacity_violations: 0,
            room_type_violations: 0,
            hour_mismatches: 0,
            lab_block_violations: 0,
            errors: ['No timetable slots found in database.'],
        };
    }
    // 2. Check room clashes: (day_of_week, period, room_id) must be unique
    const roomPeriodMap = new Map();
    let roomClashes = 0;
    for (const s of slots) {
        const key = `${s.day_of_week}-${s.period}-${s.room_id}`;
        if (roomPeriodMap.has(key)) {
            roomClashes++;
            errors.push(`Room clash: Room ${s.room_id} booked multiple times on day ${s.day_of_week}, period ${s.period}`);
        }
        roomPeriodMap.set(key, s.slot_id);
    }
    // 3. Check staff clashes: (day_of_week, period, staff_id) must be unique
    const staffPeriodMap = new Map();
    let staffClashes = 0;
    for (const s of slots) {
        const key = `${s.day_of_week}-${s.period}-${s.staff_id}`;
        if (staffPeriodMap.has(key)) {
            staffClashes++;
            errors.push(`Staff clash: Staff ${s.staff_id} teaching multiple sections on day ${s.day_of_week}, period ${s.period}`);
        }
        staffPeriodMap.set(key, s.slot_id);
    }
    // 4. Check section clashes: (day_of_week, period, section_id) must be unique
    const secPeriodMap = new Map();
    let secClashes = 0;
    for (const s of slots) {
        const key = `${s.day_of_week}-${s.period}-${s.section_id}`;
        if (secPeriodMap.has(key)) {
            secClashes++;
            errors.push(`Section clash: Section ${s.section_id} scheduled multiple times on day ${s.day_of_week}, period ${s.period}`);
        }
        secPeriodMap.set(key, s.slot_id);
    }
    // 5. Check student clashes: sections sharing students must not overlap in (day_of_week, period)
    const conflictsStmt = db.prepare(`
    SELECT DISTINCT a.section_id as s1, b.section_id as s2
    FROM section_students a
    JOIN section_students b ON a.student_id = b.student_id AND a.section_id < b.section_id
  `);
    const conflictPairs = new Set();
    for (const row of conflictsStmt.all()) {
        conflictPairs.add(`${row.s1}-${row.s2}`);
    }
    const periodSections = new Map();
    for (const s of slots) {
        const key = `${s.day_of_week}-${s.period}`;
        const list = periodSections.get(key) || [];
        list.push(s.section_id);
        periodSections.set(key, list);
    }
    let studentClashes = 0;
    for (const [dp, secIds] of periodSections.entries()) {
        for (let i = 0; i < secIds.length; i++) {
            for (let j = i + 1; j < secIds.length; j++) {
                const s1 = Math.min(secIds[i], secIds[j]);
                const s2 = Math.max(secIds[i], secIds[j]);
                if (conflictPairs.has(`${s1}-${s2}`)) {
                    studentClashes++;
                    errors.push(`Student clash at ${dp}: Section ${s1} and Section ${s2} share students and conflict at the same period`);
                }
            }
        }
    }
    // 6. Check room capacity >= section size
    let capViolations = 0;
    for (const s of slots) {
        if (s.room_capacity < s.size) {
            capViolations++;
            errors.push(`Room capacity violation: Room ${s.room_id} capacity (${s.room_capacity}) is smaller than section size (${s.size})`);
        }
    }
    // 7. Check room type: lab in computer_lab, theory in classroom/seminar_hall
    let roomTypeViolations = 0;
    for (const s of slots) {
        if (s.is_lab === 1 && s.room_type !== 'computer_lab') {
            roomTypeViolations++;
            errors.push(`Room type violation: Lab section ${s.section_id} scheduled in non-lab room ${s.room_id} (${s.room_type})`);
        }
        else if (s.is_lab === 0 && !['classroom', 'seminar_hall', 'auditorium'].includes(s.room_type)) {
            roomTypeViolations++;
            errors.push(`Room type violation: Theory section ${s.section_id} scheduled in ${s.room_id} (${s.room_type})`);
        }
    }
    // 8. Check hours per week match
    const sectionSlotsCount = new Map();
    for (const s of slots) {
        sectionSlotsCount.set(s.section_id, (sectionSlotsCount.get(s.section_id) || 0) + 1);
    }
    const sectionsStmt = db.prepare(`SELECT section_id, subject_code, hours_per_week, is_lab FROM sections`);
    const allSections = sectionsStmt.all();
    let hourMismatches = 0;
    for (const sec of allSections) {
        const scheduled = sectionSlotsCount.get(sec.section_id) || 0;
        if (scheduled !== sec.hours_per_week) {
            hourMismatches++;
            errors.push(`Hours mismatch for section ${sec.section_id} (${sec.subject_code}): expected ${sec.hours_per_week} hrs/week, but scheduled ${scheduled}`);
        }
    }
    // 9. Check consecutive lab blocks
    let labBlockViolations = 0;
    const labSections = allSections.filter((s) => s.is_lab === 1);
    for (const lSec of labSections) {
        const lSlots = slots.filter((s) => s.section_id === lSec.section_id);
        const byDay = new Map();
        for (const ls of lSlots) {
            const list = byDay.get(ls.day_of_week) || [];
            list.push({ period: ls.period, room_id: ls.room_id });
            byDay.set(ls.day_of_week, list);
        }
        for (const [day, daySlots] of byDay.entries()) {
            daySlots.sort((a, b) => a.period - b.period);
            // Check consecutive
            for (let i = 0; i < daySlots.length - 1; i++) {
                if (daySlots[i + 1].period !== daySlots[i].period + 1) {
                    labBlockViolations++;
                    errors.push(`Lab block non-consecutive on day ${day} for section ${lSec.section_id}: period ${daySlots[i].period} followed by ${daySlots[i + 1].period}`);
                }
                if (daySlots[i + 1].room_id !== daySlots[i].room_id) {
                    labBlockViolations++;
                    errors.push(`Lab block room change on day ${day} for section ${lSec.section_id}: room ${daySlots[i].room_id} to ${daySlots[i + 1].room_id}`);
                }
            }
        }
    }
    const isValid = roomClashes === 0 &&
        staffClashes === 0 &&
        secClashes === 0 &&
        studentClashes === 0 &&
        capViolations === 0 &&
        roomTypeViolations === 0 &&
        hourMismatches === 0 &&
        labBlockViolations === 0;
    return {
        valid: isValid,
        total_slots: slots.length,
        staff_clashes: staffClashes,
        room_clashes: roomClashes,
        section_clashes: secClashes,
        student_clashes: studentClashes,
        capacity_violations: capViolations,
        room_type_violations: roomTypeViolations,
        hour_mismatches: hourMismatches,
        lab_block_violations: labBlockViolations,
        errors,
    };
}
/**
 * Validates active calendar sessions in calendar_sessions table:
 * Checks that no staff, room, or section has overlapping scheduled/makeup sessions on any date & period.
 */
export function validateDatabaseCalendar() {
    const errors = [];
    const stmt = db.prepare(`
    SELECT
      c.session_id,
      c.section_id,
      c.session_date,
      c.period,
      c.room_id,
      c.staff_id,
      c.status,
      s.size,
      r.capacity as room_capacity
    FROM calendar_sessions c
    JOIN sections s ON c.section_id = s.section_id
    JOIN rooms r ON c.room_id = r.room_id
    WHERE c.status IN ('scheduled', 'makeup')
    ORDER BY c.session_date ASC, c.period ASC
  `);
    const sessions = stmt.all();
    let staffClashes = 0;
    let roomClashes = 0;
    let secClashes = 0;
    let capViolations = 0;
    const staffSlotMap = new Set();
    const roomSlotMap = new Set();
    const secSlotMap = new Set();
    for (const s of sessions) {
        const staffKey = `${s.staff_id}_${s.session_date}_${s.period}`;
        if (staffSlotMap.has(staffKey)) {
            staffClashes++;
            errors.push(`Staff clash in calendar: ${s.staff_id} double-booked on ${s.session_date} P${s.period}`);
        }
        staffSlotMap.add(staffKey);
        const roomKey = `${s.room_id}_${s.session_date}_${s.period}`;
        if (roomSlotMap.has(roomKey)) {
            roomClashes++;
            errors.push(`Room clash in calendar: ${s.room_id} double-booked on ${s.session_date} P${s.period}`);
        }
        roomSlotMap.add(roomKey);
        const secKey = `${s.section_id}_${s.session_date}_${s.period}`;
        if (secSlotMap.has(secKey)) {
            secClashes++;
            errors.push(`Section clash in calendar: section ${s.section_id} scheduled twice on ${s.session_date} P${s.period}`);
        }
        secSlotMap.add(secKey);
        if (s.room_capacity < s.size) {
            capViolations++;
            errors.push(`Room capacity violation on ${s.session_date} P${s.period}: room ${s.room_id} (cap ${s.room_capacity}) < section ${s.section_id} (size ${s.size})`);
        }
    }
    const valid = staffClashes === 0 && roomClashes === 0 && secClashes === 0 && capViolations === 0;
    return {
        valid,
        total_sessions: sessions.length,
        staff_clashes: staffClashes,
        room_clashes: roomClashes,
        section_clashes: secClashes,
        capacity_violations: capViolations,
        errors,
    };
}
