import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import { generateTimetableExcel } from '../services/export/excelService.js';
import { generateTimetablePdf, findChromiumPath, PdfExportOptions } from '../services/export/pdfService.js';
import { getExportFilePath, validateExportFilename } from '../services/export/exportStorage.js';

export const exportRouter = Router();

/**
 * GET /api/export/status
 * Checks export engine readiness (e.g. Chromium presence for PDF).
 */
exportRouter.get('/status', (_req: Request, res: Response) => {
  const chromiumPath = findChromiumPath();
  res.json({
    excel_ready: true,
    pdf_ready: Boolean(chromiumPath),
    chromium_path: chromiumPath ? 'Detected' : null,
    message: chromiumPath
      ? 'PDF engine ready (using headless Chromium)'
      : 'Chromium or Edge/Chrome browser not found on host machine. PDF export is currently unavailable.',
  });
});

/**
 * GET /api/export/excel
 * Generates and downloads the comprehensive 8-sheet Excel workbook.
 */
exportRouter.get('/excel', async (_req: Request, res: Response) => {
  try {
    const result = await generateTimetableExcel();

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.filename)}"`
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Length', result.fileSize);
    res.send(result.buffer);
  } catch (err: any) {
    res.status(500).json({
      error: {
        message: err.message || 'Failed to generate Excel export',
      },
    });
  }
});

/**
 * GET /api/export/pdf
 * Generates and downloads the landscape publication-grade PDF calendar.
 */
exportRouter.get('/pdf', async (req: Request, res: Response) => {
  try {
    const scope = (req.query.scope as any) || 'whole_college';
    const scope_value = req.query.scope_value ? String(req.query.scope_value) : undefined;
    const month = req.query.month ? String(req.query.month) : undefined;

    const options: PdfExportOptions = {
      scope,
      scope_value,
      month,
    };

    const result = await generateTimetablePdf(options);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.filename)}"`
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', result.fileSize);
    res.send(result.buffer);
  } catch (err: any) {
    res.status(500).json({
      error: {
        message: err.message || 'Failed to generate PDF export',
      },
    });
  }
});

/**
 * GET /api/export/download/:filename
 * Secure download of previously generated export files.
 */
exportRouter.get('/download/:filename', (req: Request, res: Response) => {
  try {
    const safeFilename = validateExportFilename(req.params.filename);
    const filePath = getExportFilePath(safeFilename);

    res.download(filePath, safeFilename);
  } catch (err: any) {
    res.status(404).json({
      error: {
        message: err.message || 'File not found or invalid request',
      },
    });
  }
});
