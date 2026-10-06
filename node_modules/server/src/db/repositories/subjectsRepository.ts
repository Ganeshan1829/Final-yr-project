import { db } from '../../db.js';

export interface SubjectRecord {
  subject_code: string;
  subject_name: string;
  subject_type: 'theory' | 'lab';
  credits: number | null;
  hours_per_week: number;
  total_hours: number;
  lab_block_periods: number;
  required_room_type: 'classroom' | 'computer_lab';
  department: string | null;
  semester: number | null;
}

export function getSubjects(): SubjectRecord[] {
  const stmt = db.prepare('SELECT * FROM subjects ORDER BY subject_code ASC');
  return stmt.all() as unknown as SubjectRecord[];
}

export function getSubject(code: string): SubjectRecord | null {
  const stmt = db.prepare('SELECT * FROM subjects WHERE subject_code = ?');
  const row = stmt.get(code);
  return (row as unknown as SubjectRecord) || null;
}
