import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
import { allocateSubject, loadLatestPredictions } from './allocationService.js';

export interface SplitSectionResult {
  section_id: number;
  subject_code: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
  section_label: string;
  size: number;
  required_room_type: string;
  hours_per_week: number;
  is_lab: number;
  warning_message: string | null;
  student_ids: string[];
  allocation_basis?: Record<string, unknown> | null;
}

export interface SplitResultSummary {
  success: boolean;
  total_sections: number;
  total_students_assigned: number;
  warnings: string[];
  errors: string[];
  sections: SplitSectionResult[];
}

/**
 * Executes deterministic Section Splitting according to Module 3 specification.
 * - Keeps student staff choices where provided.
 * - Distributes the remaining students by teacher capacity/preference/ML recommendation (see allocationEngine.ts),
 *   NOT as fixed equal sections.
 * - Enforces min_section_size, default_section_size, max_section_size.
 * - Checks staff shortfall and faculty workload limits.
 * - Atomic transaction: replaces previous sections cleanly.
 */
export function runSectionSplitter(): SplitResultSummary {
  const { rules } = getStoredRules();
  const minSize = rules?.min_section_size ?? 30;
  const defaultSize = rules?.default_section_size ?? 60;
  const maxSize = rules?.max_section_size ?? 70;

  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Fetch subjects
  const subjectsStmt = db.prepare(`
    SELECT subject_code, subject_name, subject_type, hours_per_week, total_hours, lab_block_periods, required_room_type, department, semester
    FROM subjects
    ORDER BY subject_code ASC
  `);
  const subjects = subjectsStmt.all() as any[];

  // 2. Fetch staff & qualifications
  const staffStmt = db.prepare(`
    SELECT staff_id, staff_name, max_hours_per_week, hours_committed_elsewhere
    FROM staff
  `);
  const staffList = staffStmt.all() as any[];
  const staffMap = new Map<string, any>(staffList.map((s) => [s.staff_id, s]));

  const staffSubjectsStmt = db.prepare(`
    SELECT staff_id, subject_code FROM staff_subjects ORDER BY staff_id ASC
  `);
  const staffSubjectsRows = staffSubjectsStmt.all() as any[];
  const qualifiedStaffBySubject = new Map<string, string[]>();
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
  const choices = choicesStmt.all() as any[];
  const choicesBySubject = new Map<string, Array<{ student_id: string; staff_id: string }>>();
  for (const c of choices) {
    const list = choicesBySubject.get(c.subject_code) || [];
    list.push({ student_id: c.student_id, staff_id: c.staff_id });
    choicesBySubject.set(c.subject_code, list);
  }

  // 4. Fetch all active students for fallback when choices are not explicitly in student_choices (e.g. labs)
  const studentsStmt = db.prepare(`SELECT student_id, department, semester FROM students ORDER BY student_id ASC`);
  const allStudents = studentsStmt.all() as any[];

  const plannedSections: Array<{
    subject_code: string;
    subject_name: string;
    staff_id: string;
    staff_name: string;
    section_label: string;
    size: number;
    required_room_type: string;
    hours_per_week: number;
    is_lab: number;
    warning_message: string | null;
    student_ids: string[];
    allocation_basis: Record<string, unknown> | null;
  }> = [];

  const staffHoursAssigned = new Map<string, number>();
  const predictions = loadLatestPredictions();

  for (const subj of subjects) {
    const code = subj.subject_code;
    const isLab = subj.subject_type === 'lab' ? 1 : 0;
    const requiredRoom = subj.required_room_type || (isLab ? 'computer_lab' : 'classroom');
    const hours = subj.hours_per_week;
    const qualifiedStaff = qualifiedStaffBySubject.get(code) || [];

    // Students enrolled in this subject
    let subjectStudents: Array<{ student_id: string; staff_id?: string }> = [];

    if (choicesBySubject.has(code)) {
      subjectStudents = choicesBySubject.get(code)!;
    } else {
      // If no explicit student_choices (mandatory department/semester subject, e.g. labs)
      subjectStudents = allStudents
        .filter((st) => (!subj.department || st.department === subj.department) && (!subj.semester || st.semester === subj.semester))
        .map((st) => ({ student_id: st.student_id }));
    }

    const totalStudents = subjectStudents.length;
    if (totalStudents === 0) continue;

    // Check max available room capacity for required room type
    const roomCapRow = db.prepare(`
      SELECT MAX(capacity) as max_cap FROM rooms WHERE status = 'active' AND room_type = ?
    `).get(requiredRoom) as any;
    const maxRoomCap = roomCapRow?.max_cap || maxSize;
    const effectiveMaxSize = Math.min(maxSize, maxRoomCap);

    // Teacher-aware, demand-aware allocation (deterministic; ML predictions are advisory targets only).
    const staffHoursView = new Map<string, { max_hours: number; committed: number; assigned: number }>();
    for (const q of qualifiedStaff) {
      const info = staffMap.get(q);
      staffHoursView.set(q, {
        max_hours: info?.max_hours_per_week ?? 20,
        committed: info?.hours_committed_elsewhere ?? 0,
        assigned: staffHoursAssigned.get(q) || 0,
      });
    }
    const allocation = allocateSubject({
      subject_code: code,
      hours_per_week: hours,
      room_capacity: effectiveMaxSize,
      min_section_size: minSize,
      qualified_staff: qualifiedStaff,
      choices: subjectStudents.filter((s) => s.staff_id).map((s) => ({ student_id: s.student_id, staff_id: s.staff_id })),
      floating_ids: subjectStudents.filter((s) => !s.staff_id).map((s) => s.student_id),
      staff_hours: staffHoursView,
      defaults: { default_size: defaultSize, rules_max: maxSize },
      predictions,
    });
    warnings.push(...allocation.warnings);

    const activeStaffEntries: Array<[string, string[]]> = allocation.allocations.map((a) => [a.staff_id, a.student_ids]);
    const basisByStaff = new Map(allocation.allocations.map((a) => [a.staff_id, a.basis]));

    if (allocation.unallocated_ids.length > 0) {
      // Never drop students: report the shortfall and keep them on the teacher with the most headroom.
      errors.push(
        `Staff shortfall for ${code} (${subj.subject_name}): ${allocation.unallocated_ids.length} of ${totalStudents} students cannot be placed within teacher limits (max class size, room capacity ${effectiveMaxSize}, remaining teaching hours).`
      );
      const host =
        activeStaffEntries[0] ?? (qualifiedStaff.length > 0 ? ([qualifiedStaff[0], []] as [string, string[]]) : null);
      if (host) {
        host[1].push(...allocation.unallocated_ids);
        if (!activeStaffEntries.includes(host)) activeStaffEntries.push(host);
      }
    }

    // If total students < minSize, keep 1 section and flag warning
    if (totalStudents < minSize) {
      warnings.push(
        `Subject ${code} (${subj.subject_name}) enrollment of ${totalStudents} is below minimum section size (${minSize}).`
      );
    }

    // Create sections
    let secIdx = 1;
    for (const [staffId, studentIds] of activeStaffEntries) {
      const sName = staffMap.get(staffId)?.staff_name || staffId;
      const sectionLabel = `${code}-S${secIdx}`;
      let warnMsg: string | null = null;

      if (studentIds.length < minSize) {
        warnMsg = `Section size (${studentIds.length}) is below minimum (${minSize})`;
      } else if (studentIds.length > maxSize) {
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
          warnings.push(
            `Faculty load limit exceeded for ${sName} (${staffId}): assigned ${newTotalHours} hrs/week exceeds net capacity ${maxTeaching} hrs/week.`
          );
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
        allocation_basis: basisByStaff.get(staffId)
          ? { ...basisByStaff.get(staffId), final_size: studentIds.length, over_preferred: studentIds.length > (basisByStaff.get(staffId)!.preferred) }
          : null,
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
        subject_code, staff_id, section_label, size, required_room_type, hours_per_week, is_lab, warning_message, created_at, allocation_basis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSecStuStmt = db.prepare(`
      INSERT INTO section_students (section_id, student_id)
      VALUES (?, ?)
    `);

    const now = new Date().toISOString();
    const finalSections: SplitSectionResult[] = [];
    let totalAssigned = 0;

    for (const plan of plannedSections) {
      const res = insertSecStmt.run(
        plan.subject_code,
        plan.staff_id,
        plan.section_label,
        plan.size,
        plan.required_room_type,
        plan.hours_per_week,
        plan.is_lab,
        plan.warning_message,
        now,
        plan.allocation_basis ? JSON.stringify(plan.allocation_basis) : null
      );

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
        allocation_basis: plan.allocation_basis,
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
  } catch (err: any) {
    db.exec('ROLLBACK;');
    throw new Error(`Failed to save section splitting: ${err.message}`);
  }
}

/**
 * Returns all current sections with joined subject and staff names.
 */
export function getSections(): SplitSectionResult[] {
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
      s.warning_message,
      s.allocation_basis
    FROM sections s
    LEFT JOIN subjects sub ON s.subject_code = sub.subject_code
    LEFT JOIN staff stf ON s.staff_id = stf.staff_id
    ORDER BY s.subject_code ASC, s.section_label ASC
  `);

  const rows = stmt.all() as any[];

  // Also query student count or IDs
  const secStuStmt = db.prepare(`SELECT student_id FROM section_students WHERE section_id = ?`);

  return rows.map((r) => {
    const stRows = secStuStmt.all(r.section_id) as any[];
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
      allocation_basis: r.allocation_basis ? JSON.parse(r.allocation_basis) : null,
      student_ids: stRows.map((s) => s.student_id),
    };
  });
}

/**
 * Previews or applies manual section size edit (Week 10 intake change case).
 * Marks downstream timetable stale.
 */
export function editSectionSize(
  sectionId: number,
  newSize: number,
  confirm: boolean = false
): {
  preview: boolean;
  section: any;
  old_size: number;
  new_size: number;
  room_capacity_ok: boolean;
  warnings: string[];
} {
  const secStmt = db.prepare(`
    SELECT s.*, sub.subject_name, sub.required_room_type as sub_room_type
    FROM sections s
    LEFT JOIN subjects sub ON s.subject_code = sub.subject_code
    WHERE s.section_id = ?
  `);
  const section = secStmt.get(sectionId) as any;
  if (!section) {
    throw new Error(`Section ID ${sectionId} not found`);
  }

  const { rules } = getStoredRules();
  const minSize = rules?.min_section_size ?? 30;
  const maxSize = rules?.max_section_size ?? 70;

  const warnings: string[] = [];
  if (newSize < minSize) {
    warnings.push(`Size ${newSize} is below allowed minimum section size (${minSize})`);
  } else if (newSize > maxSize) {
    warnings.push(`Size ${newSize} exceeds allowed maximum section size (${maxSize})`);
  }

  // Check room capacity
  const roomStmt = db.prepare(`
    SELECT MAX(capacity) as max_cap
    FROM rooms
    WHERE status = 'active' AND room_type = ?
  `);
  const roomType = section.required_room_type || section.sub_room_type || 'classroom';
  const roomRes = roomStmt.get(roomType) as any;
  const maxRoomCap = roomRes?.max_cap || 0;
  const roomCapacityOk = maxRoomCap >= newSize;

  if (!roomCapacityOk) {
    warnings.push(
      `Largest available ${roomType} has capacity ${maxRoomCap}, which is less than requested section size ${newSize}`
    );
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
