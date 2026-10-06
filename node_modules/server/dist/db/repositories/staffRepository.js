import { db } from '../../db.js';
export function getStaff() {
    const staffStmt = db.prepare('SELECT * FROM staff ORDER BY staff_id ASC');
    const staffRows = staffStmt.all();
    const subStmt = db.prepare('SELECT staff_id, subject_code FROM staff_subjects');
    const subRows = subStmt.all();
    const map = new Map();
    for (const r of subRows) {
        if (!map.has(r.staff_id)) {
            map.set(r.staff_id, []);
        }
        map.get(r.staff_id).push(r.subject_code);
    }
    return staffRows.map((s) => ({
        ...s,
        subjects_can_teach: map.get(s.staff_id) || [],
    }));
}
export function getStaffById(id) {
    const stmt = db.prepare('SELECT * FROM staff WHERE staff_id = ?');
    const row = stmt.get(id);
    if (!row)
        return null;
    const subStmt = db.prepare('SELECT subject_code FROM staff_subjects WHERE staff_id = ?');
    const subRows = subStmt.all(id);
    return {
        ...row,
        subjects_can_teach: subRows.map((s) => s.subject_code),
    };
}
export function getStaffForSubject(code) {
    const stmt = db.prepare(`
    SELECT s.* 
    FROM staff s
    JOIN staff_subjects ss ON s.staff_id = ss.staff_id
    WHERE ss.subject_code = ?
    ORDER BY s.staff_id ASC
  `);
    return stmt.all(code);
}
