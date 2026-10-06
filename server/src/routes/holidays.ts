import { Router } from 'express';
import multer from 'multer';
import {
  listHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  importHolidaysCsv,
} from '../services/holidaysService.js';
import { getStoredRules } from '../services/rulesService.js';

export const holidaysRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// GET /api/holidays
holidaysRouter.get('/', (_req, res, next) => {
  try {
    const holidays = listHolidays();
    const { rules } = getStoredRules();
    res.json({
      holidays,
      semesterRules: rules
        ? {
            semester_start: rules.semester_start,
            semester_end: rules.semester_end,
            semester_name: rules.semester_name,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/holidays
holidaysRouter.post('/', (req, res, next) => {
  try {
    const holiday = createHoliday(req.body);
    res.status(201).json({
      success: true,
      holiday,
      message: 'Holiday added successfully',
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/holidays/:id
holidaysRouter.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid holiday ID parameter' },
      });
    }

    const updated = updateHoliday(id, req.body);
    res.json({
      success: true,
      holiday: updated,
      message: 'Holiday updated successfully',
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/holidays/:id
holidaysRouter.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid holiday ID parameter' },
      });
    }

    const deleted = deleteHoliday(id);
    if (!deleted) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Holiday with ID ${id} not found` },
      });
    }

    res.json({
      success: true,
      message: 'Holiday deleted successfully',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/holidays/import
holidaysRouter.post('/import', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: { code: 'FILE_MISSING', message: 'No CSV file provided for holidays import' },
      });
    }

    const imported = importHolidaysCsv(req.file.buffer);
    res.json({
      success: true,
      count: imported.length,
      holidays: imported,
      message: `Successfully imported ${imported.length} holiday(s)`,
    });
  } catch (err) {
    next(err);
  }
});
