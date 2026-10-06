import { db } from '../../db.js';
export function getSectionsCandidates() {
    const stmt = db.prepare(`
    SELECT 
      sc.subject_code,
      sc.staff_id,
      COUNT(sc.student_id) as size,
      s.subject_name,
      s.subject_type,
      s.hours_per_week,
      s.lab_block_periods,
      s.required_room_type,
      st.staff_name
    FROM student_choices sc
    JOIN subjects s ON sc.subject_code = s.subject_code
    JOIN staff st ON sc.staff_id = st.staff_id
    GROUP BY sc.subject_code, sc.staff_id
    ORDER BY sc.subject_code ASC, sc.staff_id ASC
  `);
    return stmt.all();
}
