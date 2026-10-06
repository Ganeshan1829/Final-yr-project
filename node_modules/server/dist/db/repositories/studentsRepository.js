import { db } from '../../db.js';
export function getStudents() {
    const stmt = db.prepare('SELECT * FROM students ORDER BY student_id ASC');
    return stmt.all();
}
export function getStudentChoices() {
    const stmt = db.prepare('SELECT * FROM student_choices ORDER BY student_id ASC, subject_code ASC');
    return stmt.all();
}
export function getChoicesBySubject(code) {
    const stmt = db.prepare('SELECT * FROM student_choices WHERE subject_code = ? ORDER BY student_id ASC');
    return stmt.all(code);
}
