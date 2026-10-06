import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
/**
 * Executes deterministic Section Splitting according to Module 3 specification.
 * - Keeps student staff choices where provided.
 * - Splits students evenly across qualified staff for each subject.
 * - Enforces min_section_size, default_section_size, max_section_size.
 * - Checks staff shortfall and faculty workload limits.
 * - Atomic transaction: replaces previous sections cleanly.
 */
export function runSectionSplitter() {
    const { rules } = getStoredRules();
    const minSize = rules?.min_section_size ?? 30;
    const defaultSize = rules?.default_section_size ?? 60;
    const maxSize = rules?.max_section_size ?? 70;
    const warnings = [];
    const errors = [];
    // 1. Fetch subjects
    const subjectsStmt = db.prepare(`
    SELECT subject_code, subject_name, subject_type, hours_per_week, total_hours, lab_block_periods, required_room_type, department, semester
    FROM subjects
    ORDER BY subject_code ASC
  `);
    const subjects = subjectsStmt.all();
    // 2. Fetch staff & qualifications
    const staffStmt = db.prepare(`
    SELECT staff_id, staff_name, max_hours_per_week, hours_committed_elsewhere
    FROM staff
  `);
    const staffList = staffStmt.all();
    const staffMap = new Map(staffList.map((s) => [s.staff_id, s]));
    const staffSubjectsStmt = db.prepare(`
    SELECT staff_id, subject_code FROM staff_subjects ORDER BY staff_id ASC
  `);
    const staffSubjectsRows = staffSubjectsStmt.all();
    const qualifiedStaffBySubject = new Map();
    for (const row of staffSubjectsRows) {
        const list = qualifiedStaffBySubject.get(row.subject_code) || [];
        list.push(row.staff_id);
        qualifiedStaffBySubject.set(row.subject_code, list);
    }
    // 3. Fetch student choices
    const choicesStmt = db.prepare(`
    SELECT student_id, subject_code, staff_id, selected_at, selection_order
    FROM student_choices
    ORDER BY subject_code ASC, selected_at ASC, selection_order ASC
  `);
    const choices = choicesStmt.all();
    const choicesBySubject = new Map();
    for (const c of choices) {
        const list = choicesBySubject.get(c.subject_code) || [];
        list.push({ student_id: c.student_id, staff_id: c.staff_id });
        choicesBySubject.set(c.subject_code, list);
    }
    // 4. Fetch all active students for fallback when choices are not explicitly in student_choices (e.g. labs)
    const studentsStmt = db.prepare(`SELECT student_id, department, semester FROM students ORDER BY student_id ASC`);
    const allStudents = studentsStmt.all();
    const plannedSections = [];
    const staffHoursAssigned = new Map();
    for (const subj of subjects) {
        const code = subj.subject_code;
        const isLab = subj.subject_type === 'lab' ? 1 : 0;
        const requiredRoom = subj.required_room_type || (isLab ? 'computer_lab' : 'classroom');
        const hours = subj.hours_per_week;
        const qualifiedStaff = qualifiedStaffBySubject.get(code) || [];
        // Students enrolled in this subject
        let subjectStudents = [];
        if (choicesBySubject.has(code)) {
            subjectStudents = choicesBySubject.get(code);
        }
        else {
            // If no explicit student_choices (mandatory department/semester subject, e.g. labs)
            subjectStudents = allStudents
                .filter((st) => (!subj.department || st.department === subj.department) && (!subj.semester || st.semester === subj.semester))
                .map((st) => ({ student_id: st.student_id }));
        }
        const totalStudents = subjectStudents.length;
        if (totalStudents === 0)
            continue;
        // Check max available room capacity for required room type
        const roomCapRow = db.prepare(`
      SELECT MAX(capacity) as max_cap FROM rooms WHERE status = 'active' AND room_type = ?
    `).get(requiredRoom);
        const maxRoomCap = roomCapRow?.max_cap || maxSize;
        const effectiveMaxSize = Math.min(maxSize, maxRoomCap);
        // Check staff shortfall error
        const minStaffNeeded = Math.ceil(totalStudents / maxSize);
        if (qualifiedStaff.length < minStaffNeeded) {
            errors.push(`Staff shortfall for ${code} (${subj.subject_name}): ${totalStudents} students require at least ${minStaffNeeded} staff for max section size ${maxSize}, but only ${qualifiedStaff.length} qualified staff available.`);
        }
        // Determine sections and student allocation
        // If students already chose staff: group by staff
        const studentsByStaff = new Map();
        for (const qStaff of qualifiedStaff) {
            studentsByStaff.set(qStaff, []);
        }
        const unassignedStudents = [];
        for (const s of subjectStudents) {
            if (s.staff_id && studentsByStaff.has(s.staff_id)) {
                studentsByStaff.get(s.staff_id).push(s.student_id);
            }
            else {
                unassignedStudents.push(s.student_id);
            }
        }
        // List of active sections to create: array of { staffId, studentIds }
        const activeStaffEntries = [];
        if (unassignedStudents.length > 0 && qualifiedStaff.length > 0) {
            // Split unassigned cohort into sections of size <= effectiveMaxSize
            const numSections = Math.max(1, Math.ceil(unassignedStudents.length / effectiveMaxSize));
            const baseSize = Math.floor(unassignedStudents.length / numSections);
            let remainder = unassignedStudents.length % numSections;
            let studentIdx = 0;
            for (let sIdx = 0; sIdx < numSections; sIdx++) {
                const staffId = qualifiedStaff[sIdx % qualifiedStaff.length];
                const count = baseSize + (remainder > 0 ? 1 : 0);
                if (remainder > 0)
                    remainder--;
                const chunk = unassignedStudents.slice(studentIdx, studentIdx + count);
                studentIdx += count;
                activeStaffEntries.push([staffId, chunk]);
            }
        }
        else {
            // Rebalance if uneven beyond effectiveMaxSize
            for (const qStaff of qualifiedStaff) {
                const assigned = studentsByStaff.get(qStaff);
                if (assigned.length > effectiveMaxSize) {
                    const excessCount = assigned.length - effectiveMaxSize;
                    const excess = assigned.splice(effectiveMaxSize, excessCount);
                    // Find qualified staff with capacity
                    for (const otherStaff of qualifiedStaff) {
                        if (otherStaff !== qStaff) {
                            const otherList = studentsByStaff.get(otherStaff);
                            while (excess.length > 0 && otherList.length < effectiveMaxSize) {
                                otherList.push(excess.shift());
                            }
                        }
                    }
                    if (excess.length > 0) {
                        assigned.push(...excess);
                    }
                }
            }
            for (const [stfId, stds] of studentsByStaff.entries()) {
                if (stds.length > 0) {
                    activeStaffEntries.push([stfId, stds]);
                }
            }
        }
        // If total students < minSize, keep 1 section and flag warning
        if (totalStudents < minSize) {
            warnings.push(`Subject ${code} (${subj.subject_name}) enrollment of ${totalStudents} is below minimum section size (${minSize}).`);
        }
        // Create sections
        let secIdx = 1;
        for (const [staffId, studentIds] of activeStaffEntries) {
            const sName = staffMap.get(staffId)?.staff_name || staffId;
            const sectionLabel = `${code}-S${secIdx}`;
            let warnMsg = null;
            if (studentIds.length < minSize) {
                warnMsg = `Section size (${studentIds.length}) is below minimum (${minSize})`;
            }
            else if (studentIds.length > maxSize) {
                warnMsg = `Section size (${studentIds.length}) exceeds maximum (${maxSize})`;
            }
            // Track faculty teaching workload
            const currentHours = staffHoursAssigned.get(staffId) || 0;
            const newTotalHours = currentHours + hours;
            staffHoursAssigned.set(staffId, newTotalHours);
            const staffInfo = staffMap.get(staffId);
            if (staffInfo) {
                const maxTeaching = (staffInfo.max_hours_per_week || 20) - (staffInfo.hours_committed_elsewhere || 0);
                if (newTotalHours > maxTeaching) {
                    warnings.push(`Faculty load limit exceeded for ${sName} (${staffId}): assigned ${newTotalHours} hrs/week exceeds net capacity ${maxTeaching} hrs/week.`);
                }
            }
            plannedSections.push({
                subject_code: code,
                subject_name: subj.subject_name,
                staff_id: staffId,
                staff_name: sName,
                section_label: sectionLabel,
                size: studentIds.length,
                required_room_type: requiredRoom,
                hours_per_week: hours,
                is_lab: isLab,
                warning_message: warnMsg,
                student_ids: studentIds,
            });
            secIdx++;
        }
    }
    // 5. Atomic database transaction: replace sections & section_students
    db.exec('BEGIN TRANSACTION;');
    try {
        // Clear old timetable slots & calendar sessions dependent on old sections
        db.exec(`
      DELETE FROM suggested_makeups;
      DELETE FROM calendar_sessions;
      DELETE FROM timetable_slots;
      DELETE FROM section_students;
      DELETE FROM sections;
    `);
        const insertSecStmt = db.prepare(`
      INSERT INTO sections (
        subject_code, staff_id, section_label, size, required_room_type, hours_per_week, is_lab, warning_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const insertSecStuStmt = db.prepare(`
      INSERT INTO section_students (section_id, student_id)
      VALUES (?, ?)
    `);
        const now = new Date().toISOString();
        const finalSections = [];
        let totalAssigned = 0;
        for (const plan of plannedSections) {
            const res = insertSecStmt.run(plan.subject_code, plan.staff_id, plan.section_label, plan.size, plan.required_room_type, plan.hours_per_week, plan.is_lab, plan.warning_message, now);
            const sectionId = Number(res.lastInsertRowid);
            for (const stId of plan.student_ids) {
                insertSecStuStmt.run(sectionId, stId);
            }
            totalAssigned += plan.student_ids.length;
            finalSections.push({
                section_id: sectionId,
                subject_code: plan.subject_code,
                subject_name: plan.subject_name,
                staff_id: plan.staff_id,
                staff_name: plan.staff_name,
                section_label: plan.section_label,
                size: plan.size,
                required_room_type: plan.required_room_type,
                hours_per_week: plan.hours_per_week,
                is_lab: plan.is_lab,
                warning_message: plan.warning_message,
                student_ids: plan.student_ids,
            });
        }
        // Update engine state
        const splitStatus = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'completed';
        db.prepare(`
      UPDATE engine_state SET
        split_status = ?,
        solve_status = 'not_run',
        calendar_status = 'not_run',
        stale = 0,
        split_error = ?,
        last_split_at = ?
      WHERE id = 1
    `).run(splitStatus, errors.length > 0 ? errors.join('; ') : null, now);
        db.exec('COMMIT;');
        return {
            success: errors.length === 0,
            total_sections: finalSections.length,
            total_students_assigned: totalAssigned,
            warnings,
            errors,
            sections: finalSections,
        };
    }
    catch (err) {
        db.exec('ROLLBACK;');
        throw new Error(`Failed to save section splitting: ${err.message}`);
    }
}
/**
 * Returns all current sections with joined subject and staff names.
 */
export function getSections() {
    const stmt = db.prepare(`
    SELECT
      s.section_id,
      s.subject_code,
      sub.subject_name,
      s.staff_id,
      stf.staff_name,
      s.section_label,
      s.size,
      s.required_room_type,
      s.hours_per_week,
      s.is_lab,
      s.warning_message
    FROM sections s
    LEFT JOIN subjects sub ON s.subject_code = sub.subject_code
    LEFT JOIN staff stf ON s.staff_id = stf.staff_id
    ORDER BY s.subject_code ASC, s.section_label ASC
  `);
    const rows = stmt.all();
    // Also query student count or IDs
    const secStuStmt = db.prepare(`SELECT student_id FROM section_students WHERE section_id = ?`);
    return rows.map((r) => {
        const stRows = secStuStmt.all(r.section_id);
        return {
            section_id: r.section_id,
            subject_code: r.subject_code,
            subject_name: r.subject_name || r.subject_code,
            staff_id: r.staff_id,
            staff_name: r.staff_name || r.staff_id,
            section_label: r.section_label,
            size: r.size,
            required_room_type: r.required_room_type,
            hours_per_week: r.hours_per_week,
            is_lab: r.is_lab,
            warning_message: r.warning_message,
            student_ids: stRows.map((s) => s.student_id),
        };
    });
}
/**
 * Previews or applies manual section size edit (Week 10 intake change case).
 * Marks downstream timetable stale.
 */
export function editSectionSize(sectionId, newSize, confirm = false) {
    const secStmt = db.prepare(`
    SELECT s.*, sub.subject_name, sub.required_room_type as sub_room_type
    FROM sections s
    LEFT JOIN subjects sub ON s.subject_code = sub.subject_code
    WHERE s.section_id = ?
  `);
    const section = secStmt.get(sectionId);
    if (!section) {
        throw new Error(`Section ID ${sectionId} not found`);
    }
    const { rules } = getStoredRules();
    const minSize = rules?.min_section_size ?? 30;
    const maxSize = rules?.max_section_size ?? 70;
    const warnings = [];
    if (newSize < minSize) {
        warnings.push(`Size ${newSize} is below allowed minimum section size (${minSize})`);
    }
    else if (newSize > maxSize) {
        warnings.push(`Size ${newSize} exceeds allowed maximum section size (${maxSize})`);
    }
    // Check room capacity
    const roomStmt = db.prepare(`
    SELECT MAX(capacity) as max_cap
    FROM rooms
    WHERE status = 'active' AND room_type = ?
  `);
    const roomType = section.required_room_type || section.sub_room_type || 'classroom';
    const roomRes = roomStmt.get(roomType);
    const maxRoomCap = roomRes?.max_cap || 0;
    const roomCapacityOk = maxRoomCap >= newSize;
    if (!roomCapacityOk) {
        warnings.push(`Largest available ${roomType} has capacity ${maxRoomCap}, which is less than requested section size ${newSize}`);
    }
    if (!confirm) {
        return {
            preview: true,
            section,
            old_size: section.size,
            new_size: newSize,
            room_capacity_ok: roomCapacityOk,
            warnings,
        };
    }
    // Apply change
    const warnMsg = warnings.length > 0 ? warnings.join('; ') : null;
    db.prepare(`
    UPDATE sections SET size = ?, warning_message = ? WHERE section_id = ?
  `).run(newSize, warnMsg, sectionId);
    // Mark downstream timetable and calendar stale!
    db.prepare(`
    UPDATE engine_state SET
      stale = 1,
      solve_status = 'stale',
      calendar_status = 'stale'
    WHERE id = 1
  `).run();
    const updatedSec = secStmt.get(sectionId);
    return {
        preview: false,
        section: updatedSec,
        old_size: section.size,
        new_size: newSize,
        room_capacity_ok: roomCapacityOk,
        warnings,
    };
}
