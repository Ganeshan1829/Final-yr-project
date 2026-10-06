import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAndSaveUpload } from '../services/uploadService.js';
import { importRulesCsv } from '../services/rulesService.js';
import { importHolidaysCsv } from '../services/holidaysService.js';

export const sampleRouter = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../../../sample-data');

// POST /api/sample/load
sampleRouter.post('/load', (_req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Sample dataset loading is only available in development mode' },
      });
    }

    if (!fs.existsSync(sampleDataDir)) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'sample-data directory does not exist' },
      });
    }

    const loadedDatasets: Record<string, any> = {};

    // 1. Load Rules first
    const rulesPath = path.join(sampleDataDir, 'rules.csv');
    if (fs.existsSync(rulesPath)) {
      const rulesBuf = fs.readFileSync(rulesPath);
      const rules = importRulesCsv(rulesBuf);
      loadedDatasets['rules'] = { status: 'Configured', rules };
    }

    // 2. Load Core Datasets
    const datasetsToLoad = ['students_choices', 'subjects', 'rooms', 'staff', 'holidays'];
    for (const dsId of datasetsToLoad) {
      const filePath = path.join(sampleDataDir, `${dsId}.csv`);
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        const { record, report } = processAndSaveUpload(dsId, `${dsId}.csv`, buf);
        loadedDatasets[dsId] = {
          rowCount: record.row_count,
          status: record.status,
          report,
        };

        // If holidays, also sync into holidays table
        if (dsId === 'holidays') {
          try {
            importHolidaysCsv(buf);
          } catch {
            // ignore if already present or duplicate
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Sample datasets and rules loaded successfully',
      loaded: loadedDatasets,
    });
  } catch (err) {
    next(err);
  }
});
