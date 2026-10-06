import { Router } from 'express';
import multer from 'multer';
import {
  getStoredRules,
  saveRules,
  importRulesCsv,
  exportRulesCsv,
} from '../services/rulesService.js';

export const rulesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// GET /api/rules
rulesRouter.get('/', (_req, res, next) => {
  try {
    const { rules, updatedAt } = getStoredRules();
    res.json({
      configured: !!rules,
      rules,
      updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/rules
rulesRouter.put('/', (req, res, next) => {
  try {
    const saved = saveRules(req.body);
    res.json({
      success: true,
      rules: saved,
      message: 'Rules saved successfully',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/rules/import (accepts multipart file or raw text body)
rulesRouter.post('/import', upload.single('file'), (req, res, next) => {
  try {
    let buffer: Buffer;
    if (req.file) {
      buffer = req.file.buffer;
    } else if (req.body && typeof req.body === 'string') {
      buffer = Buffer.from(req.body, 'utf-8');
    } else if (req.body && req.body.csv) {
      buffer = Buffer.from(req.body.csv, 'utf-8');
    } else {
      return res.status(400).json({
        error: { code: 'FILE_MISSING', message: 'No rules CSV file or content provided' },
      });
    }

    const saved = importRulesCsv(buffer);
    res.json({
      success: true,
      rules: saved,
      message: 'Rules imported successfully from CSV',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/rules/export
rulesRouter.get('/export', (_req, res, next) => {
  try {
    const csv = exportRulesCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="rules.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
