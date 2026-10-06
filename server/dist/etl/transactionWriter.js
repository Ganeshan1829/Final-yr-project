import { db } from '../db.js';
export function writeCleanData(ctx) {
    db.exec('BEGIN TRANSACTION;');
    try {
        // 1. Clear child tables first for foreign key integrity
        db.exec(`
      DELETE FROM calendar_sessions;
      DELETE FROM timetable_slots;
      DELETE FROM sections;
      DELETE FROM student_choices;
      DELETE FROM students;
      DELETE FROM staff_subjects;
      DELETE FROM staff;
      DELETE FROM subjects;
      DELETE FROM rooms;
      DELETE FROM holidays_clean;
    `);
        // 2. Insert subjects
        const insertSubject = db.prepare(`
      INSERT INTO subjects (
        subject_code, subject_name, subject_type, credits,
        hours_per_week, total_hours, lab_block_periods,
        required_room_type, department, semester
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        for (const row of ctx.datasets.subjects) {
            const d = row.data;
            insertSubject.run(String(d.subject_code), String(d.subject_name || ''), String(d.subject_type || 'theory'), d.credits !== undefined && d.credits !== null && d.credits !== '' ? Number(d.credits) : null, Number(d.hours_per_week), Number(d.total_hours), Number(d.lab_block_periods), String(d.required_room_type || 'classroom'), d.department ? String(d.department) : null, d.semester !== undefined && d.semester !== null && d.semester !== '' ? Number(d.semester) : null);
        }
        // 3. Insert rooms
        const insertRoom = db.prepare(`
      INSERT INTO rooms (
        room_id, room_name, building, floor,
        capacity, room_type, has_projector, is_ac, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        for (const row of ctx.datasets.rooms) {
            const d = row.data;
            insertRoom.run(String(d.room_id), String(d.room_name || d.room_id), d.building ? String(d.building) : null, d.floor !== undefined && d.floor !== null && d.floor !== '' ? Number(d.floor) : null, Number(d.capacity), String(d.room_type || 'classroom'), d.has_projector ? 1 : 0, d.is_ac ? 1 : 0, String(d.status || 'active'));
        }
        // 4. Insert staff and staff_subjects
        const insertStaff = db.prepare(`
      INSERT INTO staff (
        staff_id, staff_name, designation, department,
        email, max_hours_per_week, hours_committed_elsewhere
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const insertStaffSubject = db.prepare(`
      INSERT INTO staff_subjects (staff_id, subject_code)
      VALUES (?, ?)
    `);
        const validSubjectCodes = new Set(ctx.datasets.subjects.map((s) => String(s.data.subject_code).toUpperCase()));
        for (const row of ctx.datasets.staff) {
            const d = row.data;
            const staffId = String(d.staff_id);
            insertStaff.run(staffId, String(d.staff_name || staffId), d.designation ? String(d.designation) : null, d.department ? String(d.department) : null, d.email ? String(d.email) : null, Number(d.max_hours_per_week), Number(d.hours_committed_elsewhere || 0));
            // staff_subjects
            if (d.subjects_can_teach) {
                const codes = String(d.subjects_can_teach)
                    .split(';')
                    .map((c) => c.trim().toUpperCase())
                    .filter((c) => c && validSubjectCodes.has(c));
                const uniqueCodes = Array.from(new Set(codes));
                for (const code of uniqueCodes) {
                    insertStaffSubject.run(staffId, code);
                }
            }
        }
        // 5. Insert students and student_choices
        const insertStudent = db.prepare(`
      INSERT INTO students (
        student_id, roll_no, student_name, department, year, semester
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
        const insertStudentChoice = db.prepare(`
      INSERT INTO student_choices (
        student_id, subject_code, staff_id, selected_at, selection_order
      ) VALUES (?, ?, ?, ?, ?)
    `);
        // Group surviving choices by student_id to extract unique student rows
        const uniqueStudents = new Map();
        const survivingChoices = ctx.datasets.students_choices.filter((r) => !r.quarantined);
        for (const row of survivingChoices) {
            const d = row.data;
            const sId = String(d.student_id);
            if (!uniqueStudents.has(sId)) {
                uniqueStudents.set(sId, {
                    student_id: sId,
                    roll_no: d.roll_no ? String(d.roll_no) : null,
                    student_name: String(d.student_name || sId),
                    department: String(d.department || ctx.rules.department),
                    year: d.year !== undefined && d.year !== null && d.year !== '' ? Number(d.year) : null,
                    semester: d.semester !== undefined && d.semester !== null && d.semester !== '' ? Number(d.semester) : null,
                });
            }
        }
        for (const student of uniqueStudents.values()) {
            insertStudent.run(student.student_id, student.roll_no, student.student_name, student.department, student.year, student.semester);
        }
        for (const row of survivingChoices) {
            const d = row.data;
            insertStudentChoice.run(String(d.student_id), String(d.subject_code), String(d.staff_id), d.selected_at ? String(d.selected_at) : null, d.selection_order !== undefined && d.selection_order !== null && d.selection_order !== ''
                ? Number(d.selection_order)
                : null);
        }
        // 6. Insert holidays_clean
        const insertHoliday = db.prepare(`
      INSERT INTO holidays_clean (
        holiday_id, name, date_from, date_to, type, applies_to, ignored
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        for (const row of ctx.datasets.holidays) {
            const d = row.data;
            insertHoliday.run(String(d.holiday_id || `HOL_${row.row_number}`), String(d.name || ''), String(d.date_from), String(d.date_to), String(d.type || 'public_holiday'), d.applies_to ? String(d.applies_to) : 'ALL', d.ignored ? 1 : 0);
        }
        db.exec('COMMIT;');
    }
    catch (err) {
        db.exec('ROLLBACK;');
        throw err;
    }
}
