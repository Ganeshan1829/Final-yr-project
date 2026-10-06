import { db } from '../../db.js';
export function getSubjects() {
    const stmt = db.prepare('SELECT * FROM subjects ORDER BY subject_code ASC');
    return stmt.all();
}
export function getSubject(code) {
    const stmt = db.prepare('SELECT * FROM subjects WHERE subject_code = ?');
    const row = stmt.get(code);
    return row || null;
}
