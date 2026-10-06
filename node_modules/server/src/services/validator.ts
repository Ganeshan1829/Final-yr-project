import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { DATASET_SCHEMAS, DatasetDefinition } from '../schemas/datasets.js';

export interface ColumnIssueSummary {
  column: string;
  emptyCount: number;
  invalidEnumCount?: number;
  invalidEnumExamples?: string[];
}

export interface ValidationReport {
  dataset: string;
  fileName: string;
  rowCount: number;
  fileSizeBytes: number;
  headersFound: string[];
  expectedColumns: string[];
  missingColumns: string[];
  unexpectedColumns: string[];
  keyColumnEmptyCounts: Record<string, number>;
  columnSummaries: Record<string, ColumnIssueSummary>;
  errors: string[];
  warnings: string[];
  isValid: boolean;
  status: 'Uploaded' | 'Has issues';
}

export interface ParseResult {
  report: ValidationReport;
  rows: Record<string, any>[];
  headers: string[];
}

/**
 * Parses file buffer (CSV or XLSX) into raw rows with headers.
 */
export function parseFileContent(
  buffer: Buffer,
  fileName: string
): { rawHeaders: string[]; rawRows: Record<string, any>[] } {
  const ext = fileName.toLowerCase().split('.').pop() || '';

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return { rawHeaders: [], rawRows: [] };
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    // sheet_to_json with header: 1 to get array of arrays first
    const rawMatrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    if (!rawMatrix || rawMatrix.length === 0) {
      return { rawHeaders: [], rawRows: [] };
    }

    const headerRow = rawMatrix[0] || [];
    const rawHeaders = headerRow.map((h: any) => String(h || '').trim()).filter((h: string) => h.length > 0);

    const rawRows: Record<string, any>[] = [];
    for (let r = 1; r < rawMatrix.length; r++) {
      const row = rawMatrix[r];
      if (!row || row.length === 0) continue;
      // Check if all cells in row are empty
      const hasValue = row.some((cell: any) => cell !== null && cell !== undefined && String(cell).trim() !== '');
      if (!hasValue) continue;

      const obj: Record<string, any> = {};
      rawHeaders.forEach((header: string, colIndex: number) => {
        obj[header] = row[colIndex] !== undefined && row[colIndex] !== null ? String(row[colIndex]).trim() : '';
      });
      rawRows.push(obj);
    }

    return { rawHeaders, rawRows };
  } else {
    // CSV using PapaParse
    const text = buffer.toString('utf-8');
    const parsed = Papa.parse<Record<string, any>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });

    const rawHeaders = (parsed.meta.fields || []).map((h) => h.trim()).filter((h) => h.length > 0);
    const rawRows = parsed.data || [];

    return { rawHeaders, rawRows };
  }
}

/**
 * Validates parsed content against dataset schema without modifying data.
 */
export function validateDatasetContent(
  datasetId: string,
  fileName: string,
  fileSizeBytes: number,
  rawHeaders: string[],
  rawRows: Record<string, any>[]
): ParseResult {
  const schema: DatasetDefinition | undefined = DATASET_SCHEMAS[datasetId];
  if (!schema) {
    throw new Error(`Unknown dataset id: ${datasetId}`);
  }

  const expectedColumns = schema.columns.map((c) => c.name);
  const normalizedExpectedMap = new Map<string, string>();
  expectedColumns.forEach((col) => normalizedExpectedMap.set(col.toLowerCase().trim(), col));

  // Build mapping from normalized file header to raw file header
  const normalizedFileHeaderToRaw = new Map<string, string>();
  const normalizedFileHeaders: string[] = [];

  rawHeaders.forEach((h) => {
    const norm = h.toLowerCase().trim();
    if (norm) {
      normalizedFileHeaderToRaw.set(norm, h);
      normalizedFileHeaders.push(norm);
    }
  });

  // Check missing columns (expected columns not found in file)
  const missingColumns: string[] = [];
  const foundSchemaCols = new Set<string>();

  expectedColumns.forEach((col) => {
    const normCol = col.toLowerCase().trim();
    if (normalizedFileHeaderToRaw.has(normCol)) {
      foundSchemaCols.add(col);
    } else {
      missingColumns.push(col);
    }
  });

  // Check unexpected columns (file headers not in expected columns)
  const unexpectedColumns: string[] = [];
  rawHeaders.forEach((h) => {
    const norm = h.toLowerCase().trim();
    if (!normalizedExpectedMap.has(norm)) {
      unexpectedColumns.push(h);
    }
  });

  const rowCount = rawRows.length;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rowCount === 0) {
    errors.push('File contains no data rows.');
  }

  if (missingColumns.length > 0) {
    errors.push(`Missing required column(s): ${missingColumns.join(', ')}`);
  }

  if (unexpectedColumns.length > 0) {
    warnings.push(`File contains unexpected column(s): ${unexpectedColumns.join(', ')}`);
  }

  // Column summaries: empty cell counts, enum checks, key column counts
  const columnSummaries: Record<string, ColumnIssueSummary> = {};
  const keyColumnEmptyCounts: Record<string, number> = {};

  // Initialize key columns count
  schema.keyColumns.forEach((k) => {
    keyColumnEmptyCounts[k] = 0;
  });

  // Check each column in the schema
  schema.columns.forEach((col) => {
    const normCol = col.name.toLowerCase().trim();
    const rawHeader = normalizedFileHeaderToRaw.get(normCol);

    const summary: ColumnIssueSummary = {
      column: col.name,
      emptyCount: 0,
    };

    if (col.enums && col.enums.length > 0) {
      summary.invalidEnumCount = 0;
      summary.invalidEnumExamples = [];
    }

    if (!rawHeader) {
      // Column is entirely missing in the file
      summary.emptyCount = rowCount;
      if (schema.keyColumns.includes(col.name)) {
        keyColumnEmptyCounts[col.name] = rowCount;
      }
    } else {
      const allowedEnums = col.enums ? new Set(col.enums.map((e) => e.toLowerCase())) : null;
      const invalidExamplesSet = new Set<string>();

      rawRows.forEach((row) => {
        const val = row[rawHeader];
        const strVal = val === null || val === undefined ? '' : String(val).trim();

        if (strVal === '') {
          summary.emptyCount++;
          if (schema.keyColumns.includes(col.name)) {
            keyColumnEmptyCounts[col.name]++;
          }
        } else if (allowedEnums) {
          if (!allowedEnums.has(strVal.toLowerCase())) {
            summary.invalidEnumCount = (summary.invalidEnumCount || 0) + 1;
            if (invalidExamplesSet.size < 5) {
              invalidExamplesSet.add(strVal);
            }
          }
        }
      });

      if (summary.invalidEnumExamples) {
        summary.invalidEnumExamples = Array.from(invalidExamplesSet);
      }
    }

    columnSummaries[col.name] = summary;

    // Add warnings for value-level issues
    if (summary.emptyCount > 0 && foundSchemaCols.has(col.name)) {
      warnings.push(`Column "${col.name}" has ${summary.emptyCount} empty cell(s).`);
    }
    if (summary.invalidEnumCount && summary.invalidEnumCount > 0) {
      const examples = summary.invalidEnumExamples?.map((e) => `"${e}"`).join(', ');
      warnings.push(
        `Column "${col.name}" has ${summary.invalidEnumCount} value(s) outside allowed list [${col.enums?.join(', ')}] (e.g. ${examples})`
      );
    }
  });

  // Report key column empty warnings specifically if any
  schema.keyColumns.forEach((keyCol) => {
    const emptyCount = keyColumnEmptyCounts[keyCol] || 0;
    if (emptyCount > 0 && foundSchemaCols.has(keyCol)) {
      warnings.push(`Key identifier column "${keyCol}" has ${emptyCount} empty value(s).`);
    }
  });

  // Status determination according to specification:
  // "Status = 'Uploaded' if no missing columns, otherwise 'Has issues'. Value-level problems are warnings and do not block"
  const isValid = missingColumns.length === 0 && rowCount > 0;
  const status: 'Uploaded' | 'Has issues' = isValid ? 'Uploaded' : 'Has issues';

  const report: ValidationReport = {
    dataset: datasetId,
    fileName,
    rowCount,
    fileSizeBytes,
    headersFound: rawHeaders,
    expectedColumns,
    missingColumns,
    unexpectedColumns,
    keyColumnEmptyCounts,
    columnSummaries,
    errors,
    warnings,
    isValid,
    status,
  };

  return {
    report,
    rows: rawRows,
    headers: rawHeaders,
  };
}
