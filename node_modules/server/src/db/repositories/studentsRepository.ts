import { db } from '../../db.js';

export interface StudentRecord {
  student_id: string;
  roll_no: string | null;
  student_name: string;
  department: string;
  year: number | null;
  semester: number | null;
}

export interface StudentChoiceRecord {
  student_id: string;
  subject_code: string;
  staff_id: string;
  selected_at: string | null;
  selection_order: number | null;
}

export function getStudents(): StudentRecord[] {
  const stmt = db.prepare('SELECT * FROM students ORDER BY student_id ASC');
  return stmt.all() as unknown as StudentRecord[];
}

export function getStudentChoices(): StudentChoiceRecord[] {
  const stmt = db.prepare('SELECT * FROM student_choices ORDER BY student_id ASC, subject_code ASC');
  return stmt.all() as unknown as StudentChoiceRecord[];
}

export function getChoicesBySubject(code: string): StudentChoiceRecord[] {
  const stmt = db.prepare(
    'SELECT * FROM student_choices WHERE subject_code = ? ORDER BY student_id ASC'
  );
  return stmt.all(code) as unknown as StudentChoiceRecord[];
}
