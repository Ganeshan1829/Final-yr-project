import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { DATASET_SCHEMAS, DatasetDefinition, ALL_UPLOADABLE_DATASET_IDS } from '../schemas/datasets.js';
import { parseFileContent, validateDatasetContent, ValidationReport } from './validator.js';
import { markRunsStale } from '../db/repositories/etlRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsBaseDir = process.env.APP_DATA_DIR ? path.resolve(process.env.APP_DATA_DIR, 'uploads') : path.resolve(__dirname, '../../uploads');

export interface UploadRecord {
  id: number;
  dataset: string;
  original_filename: string;
  stored_path: string;
  row_count: number;
  status: 'Uploaded' | 'Has issues';
  report: ValidationReport;
  uploaded_at: string;
}

export interface DatasetStatusSummary {
  id: string;
  name: string;
  description: string;
  isRequired: boolean;
  expectedColumns: string[];
  keyColumns: string[];
  isUploaded: boolean;
  status: 'Uploaded' | 'Has issues' | 'Not uploaded';
  fileName: string | null;
  rowCount: number;
  uploadedAt: string | null;
  report: ValidationReport | null;
}

export function getAllDatasetsStatus(): DatasetStatusSummary[] {
  const stmt = db.prepare('SELECT * FROM uploads');
  const rows = stmt.all() as any[];
  const uploadMap = new Map<string, any>();
  rows.forEach((r) => uploadMap.set(r.dataset, r));

  return ALL_UPLOADABLE_DATASET_IDS.map((datasetId) => {
    const schema = DATASET_SCHEMAS[datasetId];
    const upload = uploadMap.get(datasetId);

    if (!upload) {
      return {
        id: datasetId,
        name: schema.name,
        description: schema.description,
        isRequired: schema.isRequired,
        expectedColumns: schema.columns.map((c) => c.name),
        keyColumns: schema.keyColumns,
        isUploaded: false,
        status: 'Not uploaded',
        fileName: null,
        rowCount: 0,
        uploadedAt: null,
        report: null,
      };
    }

    let report: ValidationReport | null = null;
    try {
      report = JSON.parse(upload.report_json);
    } catch {
      report = null;
    }

    return {
      id: datasetId,
      name: schema.name,
      description: schema.description,
      isRequired: schema.isRequired,
      expectedColumns: schema.columns.map((c) => c.name),
      keyColumns: schema.keyColumns,
      isUploaded: true,
      status: upload.status as 'Uploaded' | 'Has issues',
      fileName: upload.original_filename,
      rowCount: upload.row_count,
      uploadedAt: upload.uploaded_at,
      report,
    };
  });
}

export function processAndSaveUpload(
  datasetId: string,
  originalFilename: string,
  buffer: Buffer
): { record: UploadRecord; report: ValidationReport } {
  const schema: DatasetDefinition | undefined = DATASET_SCHEMAS[datasetId];
  if (!schema) {
    throw new Error(`Invalid dataset: ${datasetId}`);
  }

  // 1. Parse and validate
  const { rawHeaders, rawRows } = parseFileContent(buffer, originalFilename);
  const { report, rows } = validateDatasetContent(
    datasetId,
    originalFilename,
    buffer.length,
    rawHeaders,
    rawRows
  );

  // 2. Prepare file storage path
  const datasetDir = path.join(uploadsBaseDir, datasetId);
  if (!fs.existsSync(datasetDir)) {
    fs.mkdirSync(datasetDir, { recursive: true });
  }

  const timestamp = Date.now();
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedFilename = `${timestamp}_${safeFilename}`;
  const storedFilePath = path.join(datasetDir, storedFilename);

  // Write file to disk
  fs.writeFileSync(storedFilePath, buffer);

  // 3. Remove existing upload for this dataset if present
  const existingStmt = db.prepare('SELECT id, stored_path FROM uploads WHERE dataset = ?');
  const existing = existingStmt.get(datasetId) as any;

  if (existing) {
    // Delete old physical file if it exists
    if (existing.stored_path && fs.existsSync(existing.stored_path)) {
      try {
        fs.unlinkSync(existing.stored_path);
      } catch (err) {
        // ignore unlink error
      }
    }
    // Delete existing rows and upload record
    db.prepare('DELETE FROM dataset_rows WHERE upload_id = ?').run(existing.id);
    db.prepare('DELETE FROM uploads WHERE id = ?').run(existing.id);
  }

  // 4. Insert new upload record
  const insertUploadStmt = db.prepare(`
    INSERT INTO uploads (dataset, original_filename, stored_path, row_count, status, report_json, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const uploadedAt = new Date().toISOString();
  const result = insertUploadStmt.run(
    datasetId,
    originalFilename,
    storedFilePath,
    rows.length,
    report.status,
    JSON.stringify(report),
    uploadedAt
  );

  const uploadId = Number(result.lastInsertRowid);

  // 5. Insert dataset_rows in batch
  const insertRowStmt = db.prepare(`
    INSERT INTO dataset_rows (upload_id, row_index, row_json)
    VALUES (?, ?, ?)
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (let i = 0; i < rows.length; i++) {
      insertRowStmt.run(uploadId, i + 1, JSON.stringify(rows[i]));
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  markRunsStale();

  const record: UploadRecord = {
    id: uploadId,
    dataset: datasetId,
    original_filename: originalFilename,
    stored_path: storedFilePath,
    row_count: rows.length,
    status: report.status,
    report,
    uploaded_at: uploadedAt,
  };

  return { record, report };
}

export function getDatasetPreview(datasetId: string, limit: number = 25) {
  const uploadStmt = db.prepare('SELECT * FROM uploads WHERE dataset = ?');
  const upload = uploadStmt.get(datasetId) as any;

  if (!upload) {
    return null;
  }

  const rowsStmt = db.prepare(
    'SELECT row_index, row_json FROM dataset_rows WHERE upload_id = ? ORDER BY row_index ASC LIMIT ?'
  );
  const rowRecords = rowsStmt.all(upload.id, limit) as any[];

  const rows = rowRecords.map((r) => {
    try {
      return JSON.parse(r.row_json);
    } catch {
      return {};
    }
  });

  let report: ValidationReport | null = null;
  try {
    report = JSON.parse(upload.report_json);
  } catch {
    report = null;
  }

  return {
    dataset: datasetId,
    original_filename: upload.original_filename,
    totalRows: upload.row_count,
    previewRows: rows,
    status: upload.status,
    uploaded_at: upload.uploaded_at,
    report,
  };
}

export function generateTemplateCsv(datasetId: string): string {
  const schema = DATASET_SCHEMAS[datasetId];
  if (!schema) {
    throw new Error(`Unknown dataset id: ${datasetId}`);
  }
  return schema.columns.map((c) => c.name).join(',') + '\n';
}

export function deleteDataset(datasetId: string): boolean {
  const existingStmt = db.prepare('SELECT id, stored_path FROM uploads WHERE dataset = ?');
  const existing = existingStmt.get(datasetId) as any;

  if (!existing) {
    return false;
  }

  if (existing.stored_path && fs.existsSync(existing.stored_path)) {
    try {
      fs.unlinkSync(existing.stored_path);
    } catch {
      // ignore
    }
  }

  db.prepare('DELETE FROM dataset_rows WHERE upload_id = ?').run(existing.id);
  db.prepare('DELETE FROM uploads WHERE id = ?').run(existing.id);

  markRunsStale();

  return true;
}
