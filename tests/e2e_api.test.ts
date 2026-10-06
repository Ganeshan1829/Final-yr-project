import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAndSaveUpload, getAllDatasetsStatus, deleteDataset } from '../server/src/services/uploadService.js';
import { saveRules, importRulesCsv } from '../server/src/services/rulesService.js';
import { getReadiness } from '../server/src/services/readinessService.js';
import { createEvent, validateEvent } from '../server/src/services/eventsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../sample-data');

describe('E2E Backend & Acceptance Criteria Tests', () => {
  beforeAll(() => {
    // Clean up test tables if needed
    ['students_choices', 'subjects', 'rooms', 'staff', 'holidays'].forEach((ds) => {
      deleteDataset(ds);
    });
  });

  it('Criteria 1: Uploading the sample files shows "Uploaded" with exact required row counts', () => {
    // 1. students_choices.csv (960)
    const scBuf = fs.readFileSync(path.join(sampleDataDir, 'students_choices.csv'));
    const scRes = processAndSaveUpload('students_choices', 'students_choices.csv', scBuf);
    expect(scRes.report.status).toBe('Uploaded');
    expect(scRes.report.rowCount).toBe(960);

    // 2. subjects.csv (8)
    const subBuf = fs.readFileSync(path.join(sampleDataDir, 'subjects.csv'));
    const subRes = processAndSaveUpload('subjects', 'subjects.csv', subBuf);
    expect(subRes.report.status).toBe('Uploaded');
    expect(subRes.report.rowCount).toBe(8);

    // 3. rooms.csv (17)
    const roomBuf = fs.readFileSync(path.join(sampleDataDir, 'rooms.csv'));
    const roomRes = processAndSaveUpload('rooms', 'rooms.csv', roomBuf);
    expect(roomRes.report.status).toBe('Uploaded');
    expect(roomRes.report.rowCount).toBe(17);

    // 4. staff.csv (14)
    const staffBuf = fs.readFileSync(path.join(sampleDataDir, 'staff.csv'));
    const staffRes = processAndSaveUpload('staff', 'staff.csv', staffBuf);
    expect(staffRes.report.status).toBe('Uploaded');
    expect(staffRes.report.rowCount).toBe(14);

    // 5. holidays.csv (11)
    const holBuf = fs.readFileSync(path.join(sampleDataDir, 'holidays.csv'));
    const holRes = processAndSaveUpload('holidays', 'holidays.csv', holBuf);
    expect(holRes.report.status).toBe('Uploaded');
    expect(holRes.report.rowCount).toBe(11);
  });

  it('Criteria 2: Removing one column from a CSV and re-uploading shows "Has issues" and names the missing column', () => {
    // Read subjects.csv, remove subject_type column
    const originalCsv = fs.readFileSync(path.join(sampleDataDir, 'subjects.csv'), 'utf-8');
    const lines = originalCsv.split('\n');
    // Header is line 0: remove subject_type
    const modifiedHeader = lines[0].replace('subject_type,', '');
    const modifiedLines = [modifiedHeader];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      // remove 3rd token (theory/lab)
      const parts = lines[i].split(',');
      parts.splice(2, 1);
      modifiedLines.push(parts.join(','));
    }
    const modifiedCsv = modifiedLines.join('\n');

    const res = processAndSaveUpload('subjects', 'subjects_tampered.csv', Buffer.from(modifiedCsv));
    expect(res.report.status).toBe('Has issues');
    expect(res.report.missingColumns).toContain('subject_type');
    expect(res.report.errors.some((e) => e.includes('Missing required column(s): subject_type'))).toBe(true);

    // Restore subjects.csv for remaining tests
    const subBuf = fs.readFileSync(path.join(sampleDataDir, 'subjects.csv'));
    processAndSaveUpload('subjects', 'subjects.csv', subBuf);
  });

  it('Criteria 3: "Proceed to validation" is enabled only when students_choices, subjects, rooms, staff and rules are all present with no missing columns', () => {
    // Let's test readiness
    const rulesBuf = fs.readFileSync(path.join(sampleDataDir, 'rules.csv'));
    importRulesCsv(rulesBuf);

    const readiness = getReadiness();
    expect(readiness.completedRequiredCount).toBe(5);
    expect(readiness.totalRequiredCount).toBe(5);
    expect(readiness.isReadyForValidation).toBe(true);

    // Now remove subjects and check readiness again
    deleteDataset('subjects');
    const readinessAfterDelete = getReadiness();
    expect(readinessAfterDelete.isReadyForValidation).toBe(false);
    expect(readinessAfterDelete.completedRequiredCount).toBe(4);

    // Restore subjects
    const subBuf = fs.readFileSync(path.join(sampleDataDir, 'subjects.csv'));
    processAndSaveUpload('subjects', 'subjects.csv', subBuf);
  });

  it('Criteria 6: Event with an unknown venue_room_id fails validation with a clear message', () => {
    const invalidEvent = {
      event_id: 'EVT-TEST-UNKNOWN',
      event_name: 'Test Event in Unknown Room',
      event_type: 'Workshop',
      date: '2026-09-10',
      start_period: 2,
      end_period: 3,
      venue_room_id: 'NON_EXISTENT_ROOM_XYZ',
      staff_involved: ['STF001'],
      student_scope: 'ALL' as const,
      expected_attendance: 50,
    };

    const validation = validateEvent(invalidEvent);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('Unknown venue_room_id: "NON_EXISTENT_ROOM_XYZ"');

    expect(() => createEvent(invalidEvent)).toThrowError(/Unknown venue_room_id/);
  });
});
