import { db } from '../../db.js';

export interface SectionCandidate {
  subject_code: string;
  staff_id: string;
  size: number;
  subject_name: string;
  subject_type: 'theory' | 'lab';
  hours_per_week: number;
  lab_block_periods: number;
  required_room_type: string;
  staff_name: string;
}

export function getSectionsCandidates(): SectionCandidate[] {
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
  return stmt.all() as unknown as SectionCandidate[];
}
