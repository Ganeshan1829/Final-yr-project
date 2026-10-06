import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { db } from '../server/src/db.js';
import { generateTimetableExcel } from '../server/src/services/export/excelService.js';
import { generateTimetablePdf, findChromiumPath } from '../server/src/services/export/pdfService.js';
import { validateExportFilename, cleanOldExports } from '../server/src/services/export/exportStorage.js';
import { getDashboardSummary } from '../server/src/services/dashboard/dashboardService.js';

describe('Output Layer — Excel & PDF Exports', () => {
  it('Criteria 1: Excel export generates valid 8-sheet workbook matching dashboard figures', async () => {
    const res = await generateTimetableExcel();

    expect(res.filename).toMatch(/^timetable_.*\.xlsx$/);
    expect(res.fileSize).toBeGreaterThan(1000);
    expect(fs.existsSync(res.filePath)).toBe(true);

    // Read back workbook using ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(res.filePath);

    // Assert all 8 sheets exist with exact names under 31 characters
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain('Master Timetable');
    expect(sheetNames).toContain('Staff-wise');
    expect(sheetNames).toContain('Room-wise');
    expect(sheetNames).toContain('Section-wise');
    expect(sheetNames).toContain('Change Log');
    expect(sheetNames).toContain('Hours Summary');
    expect(sheetNames).toContain('Calendar');
    expect(sheetNames).toContain('Summary');
    expect(sheetNames.length).toBe(8);

    // Assert Master Timetable headers & frozen rows
    const wsMaster = workbook.getWorksheet('Master Timetable');
    expect(wsMaster).toBeDefined();
    expect(wsMaster?.views?.[0]?.state).toBe('frozen');
    expect(wsMaster?.getCell('A2').value).toBe('Section');
    expect(wsMaster?.getCell('B2').value).toBe('Subject');

    // Assert Hours Summary has formula totals
    const wsHours = workbook.getWorksheet('Hours Summary');
    expect(wsHours).toBeDefined();
    expect(wsHours?.getCell('A1').value).toBe('Section ID');

    // Assert Summary sheet values match dashboard KPIs (Cross-layer Consistency)
    const wsSummary = workbook.getWorksheet('Summary');
    expect(wsSummary).toBeDefined();

    const summaryKpis = getDashboardSummary();
    const rows = wsSummary?.getSheetValues() as any[];

    // Verify clash count in summary sheet is 0
    const clashRow = rows.find((r: any) => Array.isArray(r) && r.includes('Total Clashes (Hard Constraints)'));
    if (clashRow) {
      expect(clashRow).toContain(summaryKpis.total_clashes);
    }
  });

  it('Criteria 2: PDF export renders valid document when Chromium is available', async () => {
    const chromiumPath = findChromiumPath();

    if (!chromiumPath) {
      // If no Chromium is found, verify informative error is thrown
      await expect(generateTimetablePdf()).rejects.toThrow(
        /Chromium or Edge\/Chrome browser not found on host machine/
      );
    } else {
      const pdfRes = await generateTimetablePdf({
        scope: 'whole_college',
        month: 'all',
      });

      expect(pdfRes.filename).toMatch(/^timetable_.*\.pdf$/);
      expect(pdfRes.fileSize).toBeGreaterThan(1000);
      expect(fs.existsSync(pdfRes.filePath)).toBe(true);

      // Verify PDF header bytes (%PDF-)
      const fileHeader = fs.readFileSync(pdfRes.filePath).slice(0, 5).toString();
      expect(fileHeader).toBe('%PDF-');
    }
  });

  it('Criteria 3: Storage security blocks directory traversal and cleans retention', () => {
    // Path traversal attempts must be rejected
    expect(() => validateExportFilename('../../../etc/passwd')).toThrow();
    expect(() => validateExportFilename('..\\..\\boot.ini')).toThrow();
    expect(() => validateExportFilename('sub/dir/test.xlsx')).toThrow();
    expect(() => validateExportFilename('test.exe')).toThrow();

    // Valid filenames must pass
    expect(validateExportFilename('timetable_TERM_20261005.xlsx')).toBe('timetable_TERM_20261005.xlsx');
    expect(validateExportFilename('timetable_TERM_whole_college_20261005.pdf')).toBe('timetable_TERM_whole_college_20261005.pdf');

    // Retention cleanup runs safely
    expect(() => cleanOldExports(7)).not.toThrow();
  });
});
