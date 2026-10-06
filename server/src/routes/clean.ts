import { Router } from 'express';
import Papa from 'papaparse';
import { db } from '../db.js';
import { getCleanSummary } from '../db/repositories/etlRepository.js';

export const cleanRouter = Router();

// GET /api/clean/summary
cleanRouter.get('/summary', (_req, res) => {
  const summary = getCleanSummary();
  res.json(summary);
});

const ALLOWED_DATASETS = ['students_choices', 'subjects', 'rooms', 'staff', 'holidays'];

function getCleanQuery(dataset: string): { sql: string; countSql: string } {
  switch (dataset) {
    case 'subjects':
      return {
        sql: 'SELECT * FROM subjects ORDER BY subject_code ASC',
        countSql: 'SELECT COUNT(*) as count FROM subjects',
      };
    case 'rooms':
      return {
        sql: 'SELECT * FROM rooms ORDER BY room_id ASC',
        countSql: 'SELECT COUNT(*) as count FROM rooms',
      };
    case 'staff':
      return {
        sql: `
          SELECT s.*, 
                 COALESCE(GROUP_CONCAT(ss.subject_code, ';'), '') as subjects_can_teach
          FROM staff s
          LEFT JOIN staff_subjects ss ON s.staff_id = ss.staff_id
          GROUP BY s.staff_id
          ORDER BY s.staff_id ASC
        `,
        countSql: 'SELECT COUNT(*) as count FROM staff',
      };
    case 'holidays':
      return {
        sql: 'SELECT * FROM holidays_clean ORDER BY date_from ASC',
        countSql: 'SELECT COUNT(*) as count FROM holidays_clean',
      };
    case 'students_choices':
      return {
        sql: `
          SELECT 
            sc.student_id,
            st.roll_no,
            st.student_name,
            st.department,
            st.year,
            st.semester,
            sc.subject_code,
            sc.staff_id,
            sc.selected_at,
            sc.selection_order
          FROM student_choices sc
          JOIN students st ON sc.student_id = st.student_id
          ORDER BY sc.student_id ASC, sc.subject_code ASC
        `,
        countSql: 'SELECT COUNT(*) as count FROM student_choices',
      };
    default:
      throw new Error(`Unsupported dataset: ${dataset}`);
  }
}

// GET /api/clean/:dataset.csv
cleanRouter.get('/:dataset.csv', (req, res) => {
  const { dataset } = req.params;
  if (!ALLOWED_DATASETS.includes(dataset)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_DATASET',
        message: `Dataset must be one of: ${ALLOWED_DATASETS.join(', ')}`,
      },
    });
  }

  const { sql } = getCleanQuery(dataset);
  const rows = db.prepare(sql).all();

  const csv = Papa.unparse(rows, { quotes: true, header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="clean_${dataset}.csv"`);
  res.send(csv);
});

// GET /api/clean/:dataset
cleanRouter.get('/:dataset', (req, res) => {
  const { dataset } = req.params;
  if (!ALLOWED_DATASETS.includes(dataset)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_DATASET',
        message: `Dataset must be one of: ${ALLOWED_DATASETS.join(', ')}`,
      },
    });
  }

  const { sql, countSql } = getCleanQuery(dataset);

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(req.query.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const countRow = db.prepare(countSql).get() as { count: number };
  const total = countRow.count;

  const dataStmt = db.prepare(`${sql} LIMIT ? OFFSET ?`);
  const rows = dataStmt.all(pageSize, offset);

  res.json({
    dataset,
    rows,
    total,
    page,
    pageSize,
  });
});

