import { db } from '../../db.js';

export interface StaffRecord {
  staff_id: string;
  staff_name: string;
  designation: string | null;
  department: string | null;
  email: string | null;
  max_hours_per_week: number;
  hours_committed_elsewhere: number;
}

export interface StaffWithSubjectsRecord extends StaffRecord {
  subjects_can_teach: string[];
}

export function getStaff(): StaffWithSubjectsRecord[] {
  const staffStmt = db.prepare('SELECT * FROM staff ORDER BY staff_id ASC');
  const staffRows = staffStmt.all() as unknown as StaffRecord[];

  const subStmt = db.prepare('SELECT staff_id, subject_code FROM staff_subjects');
  const subRows = subStmt.all() as unknown as Array<{ staff_id: string; subject_code: string }>;

  const map = new Map<string, string[]>();
  for (const r of subRows) {
    if (!map.has(r.staff_id)) {
      map.set(r.staff_id, []);
    }
    map.get(r.staff_id)!.push(r.subject_code);
  }

  return staffRows.map((s) => ({
    ...s,
    subjects_can_teach: map.get(s.staff_id) || [],
  }));
}

export function getStaffById(id: string): StaffWithSubjectsRecord | null {
  const stmt = db.prepare('SELECT * FROM staff WHERE staff_id = ?');
  const row = stmt.get(id) as unknown as StaffRecord | undefined;
  if (!row) return null;

  const subStmt = db.prepare('SELECT subject_code FROM staff_subjects WHERE staff_id = ?');
  const subRows = subStmt.all(id) as unknown as Array<{ subject_code: string }>;

  return {
    ...row,
    subjects_can_teach: subRows.map((s) => s.subject_code),
  };
}

export function getStaffForSubject(code: string): StaffRecord[] {
  const stmt = db.prepare(`
    SELECT s.* 
    FROM staff s
    JOIN staff_subjects ss ON s.staff_id = ss.staff_id
    WHERE ss.subject_code = ?
    ORDER BY s.staff_id ASC
  `);
  return stmt.all(code) as unknown as StaffRecord[];
}
