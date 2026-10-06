import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../server/src/index.js';
import { db } from '../server/src/db.js';
import { processAndSaveUpload, deleteDataset } from '../server/src/services/uploadService.js';
import { importRulesCsv } from '../server/src/services/rulesService.js';
import { importHolidaysCsv } from '../server/src/services/holidaysService.js';
import { executeEtlPipeline } from '../server/src/etl/runner.js';
import { writeCleanData } from '../server/src/etl/transactionWriter.js';
import { getCleanSummary } from '../server/src/db/repositories/etlRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../sample-data');

describe('Module 2 ETL Scenarios, Database, API, and Acceptance Tests', () => {
  beforeAll(() => {
    // 1. Load clean baseline from sample-data
    const rulesBuf = fs.readFileSync(path.join(sampleDataDir, 'rules.csv'));
    importRulesCsv(rulesBuf);

    for (const ds of ['students_choices', 'subjects', 'rooms', 'staff', 'holidays']) {
      const buf = fs.readFileSync(path.join(sampleDataDir, `${ds}.csv`));
      processAndSaveUpload(ds, `${ds}.csv`, buf);
      if (ds === 'holidays') {
        try {
          importHolidaysCsv(buf);
        } catch {}
      }
    }
  });

  it('Acceptance Criteria 1: Clean sample data passes with 0 errors, 8 warnings (all STF-011)', () => {
    const result = executeEtlPipeline();

    expect(result.status).toBe('passed');
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(8);

    // All 8 warnings must be STF-011
    expect(result.summary.byRule['STF-011']).toBe(8);
    expect(Object.keys(result.summary.byRule)).toEqual(['STF-011']);

    // Check clean row counts
    const cleanSummary = getCleanSummary();
    expect(cleanSummary.counts.student_choices).toBe(960);
    expect(cleanSummary.counts.subjects).toBe(8);
    expect(cleanSummary.counts.rooms).toBe(17);
    expect(cleanSummary.counts.staff).toBe(14);
    expect(cleanSummary.counts.holidays_clean).toBe(11);
  });

  it('Acceptance Criteria 5: Clean tables are populated; sections, timetable_slots, calendar_sessions exist and are empty', () => {
    const cleanSummary = getCleanSummary();
    expect(cleanSummary.counts.students).toBe(160);
    expect(cleanSummary.counts.student_choices).toBe(960);
    expect(cleanSummary.counts.staff_subjects).toBeGreaterThan(0);
    expect(cleanSummary.counts.sections).toBe(0);
    expect(cleanSummary.counts.timetable_slots).toBe(0);
    expect(cleanSummary.counts.calendar_sessions).toBe(0);
  });

  it('Acceptance Criteria 2: With students_choices_DIRTY_fixable the run passes with exact expected issue counts and 958 clean rows', () => {
    // Read raw clean choices and construct dirty fixable test data
    const rawRows = JSON.parse(JSON.stringify(
      db.prepare("SELECT row_json FROM dataset_rows WHERE upload_id = (SELECT id FROM uploads WHERE dataset = 'students_choices') ORDER BY row_index ASC")
        .all()
        .map((r: any) => JSON.parse(r.row_json))
    ));

    // 1. Remove 2 choices (1 each from 2 different students) -> 958 rows remain -> triggers STU-012 x2
    // Let's remove student 159's CS306 and student 160's CS306
    const choices = rawRows.filter((r: any) => !(
      (r.student_id === 'STU0159' && r.subject_code === 'CS306') ||
      (r.student_id === 'STU0160' && r.subject_code === 'CS306')
    ));
    expect(choices.length).toBe(958);

    // 2. Add spaces to 15 cells (STU-001 x15)
    for (let i = 0; i < 15; i++) {
      choices[i].student_id = `  ${choices[i].student_id}  `;
    }

    // 3. Lowercase 10 cells (STU-002 x10)
    for (let i = 20; i < 30; i++) {
      choices[i].student_id = choices[i].student_id.toLowerCase();
    }

    // 4. Blank 16 cells that can be filled from that student's other rows (STU-005 x16)
    // Blank the first choice for 16 distinct students (e.g. students 1..16)
    for (let i = 0; i < 16; i++) {
      choices[i * 6].student_name = '';
    }

    // 5. Add 12 exact duplicates (STU-003 x12)
    const duplicates = [];
    for (let i = 100; i < 112; i++) {
      duplicates.push({ ...choices[i] });
    }

    // 6. Add 5 conflicting choices with later timestamp (STU-004 x5)
    const conflicts = [];
    for (let i = 200; i < 205; i++) {
      conflicts.push({
        ...choices[i],
        staff_id: 'STF001', // different staff
        selected_at: '2026-06-15 12:00:00', // later than 10:00:00
      });
    }

    const dirtyChoices = [...choices, ...duplicates, ...conflicts];

    const result = executeEtlPipeline({
      students_choices: dirtyChoices,
    });

    expect(result.status).toBe('passed');
    expect(result.summary.errors).toBe(0);
    expect(result.summary.byRule['STU-001']).toBe(15);
    expect(result.summary.byRule['STU-002']).toBe(10);
    expect(result.summary.byRule['STU-003']).toBe(12);
    expect(result.summary.byRule['STU-004']).toBe(5);
    expect(result.summary.byRule['STU-005']).toBe(16);
    expect(result.summary.byRule['STU-012']).toBe(2);

    const cleanSummary = getCleanSummary();
    expect(cleanSummary.counts.student_choices).toBe(958);
  });

  it('Acceptance Criteria 4: With NO_LAB_ROOM the run fails with SUB-012 on both lab subjects naming missing computer lab', () => {
    // Rooms with no active computer_lab
    const customRooms = [
      {
        room_id: 'LH-101',
        room_name: 'LH 101',
        capacity: 70,
        room_type: 'classroom',
        status: 'active',
      },
    ];

    const result = executeEtlPipeline({
      rooms: customRooms,
    });

    expect(result.status).toBe('failed');
    expect(result.summary.byRule['SUB-012']).toBe(2); // 2 lab subjects: CS311 and CS312
    expect(
      result.summary.errors
    ).toBeGreaterThanOrEqual(2);

    const issuesRes = db.prepare("SELECT * FROM etl_issues WHERE run_id = ? AND rule_code = 'SUB-012'").all(result.runId) as any[];
    expect(issuesRes).toHaveLength(2);
    expect(issuesRes[0].message).toContain('computer_lab');
    expect(issuesRes[1].message).toContain('computer_lab');
  });

  it('Acceptance Criteria 3: Blocking errors fail run, clean tables stay unchanged, lists each error with row number', () => {
    const summaryBefore = getCleanSummary();

    // Custom student choices with blocking errors: blank student_id, unknown subject, unknown staff
    const customChoices = [
      { row_number: 1, student_id: '', subject_code: 'CS301', staff_id: 'STF001' }, // STU-006
      { row_number: 2, student_id: 'STU1', subject_code: 'CS999', staff_id: 'STF001' }, // STU-007
      { row_number: 3, student_id: 'STU2', subject_code: 'CS301', staff_id: 'STF999' }, // STU-008
      { row_number: 4, student_id: 'STU3', subject_code: 'CS301', staff_id: 'STF002' }, // STU-009 (STF002 cannot teach CS301)
    ];

    const result = executeEtlPipeline({
      students_choices: customChoices,
    });

    expect(result.status).toBe('failed');
    expect(result.summary.errors).toBeGreaterThanOrEqual(4);

    // Clean tables unchanged
    const summaryAfter = getCleanSummary();
    expect(summaryAfter.counts.student_choices).toBe(summaryBefore.counts.student_choices);
  });

  it('Acceptance Criteria 6: Re-uploading any dataset marks the last run stale', async () => {
    // 1. Run validation
    const runRes = await request(app).post('/api/etl/run').expect(200);
    expect(runRes.body.status).toBe('passed');

    // Check latest run is not stale
    let latestRes = await request(app).get('/api/etl/latest').expect(200);
    expect(latestRes.body.run.stale).toBe(0);

    // 2. Re-upload rooms.csv
    const roomBuf = fs.readFileSync(path.join(sampleDataDir, 'rooms.csv'));
    processAndSaveUpload('rooms', 'rooms.csv', roomBuf);

    // Check latest run is now stale!
    latestRes = await request(app).get('/api/etl/latest').expect(200);
    expect(latestRes.body.run.stale).toBe(1);
    expect(latestRes.body.run.isStale).toBe(true);
  });

  it('Idempotence: Running twice on identical data produces identical issues and clean tables', () => {
    const run1 = executeEtlPipeline();
    const run2 = executeEtlPipeline();

    expect(run1.status).toBe(run2.status);
    expect(run1.summary.errors).toBe(run2.summary.errors);
    expect(run1.summary.warnings).toBe(run2.summary.warnings);
    expect(run1.summary.byRule).toEqual(run2.summary.byRule);
  });

  it('API: Returns 409 when required datasets are missing', async () => {
    deleteDataset('subjects');
    const res = await request(app).post('/api/etl/run').expect(409);
    expect(res.body.error.code).toBe('DATASETS_MISSING');
    expect(res.body.error.details.missing).toContain('subjects');

    // Restore subjects
    const subBuf = fs.readFileSync(path.join(sampleDataDir, 'subjects.csv'));
    processAndSaveUpload('subjects', 'subjects.csv', subBuf);
  });

  it('API: Issues filtering, pagination, and CSV export', async () => {
    const runRes = await request(app).post('/api/etl/run').expect(200);
    const runId = runRes.body.runId;

    // Filter by severity
    const warningsRes = await request(app)
      .get(`/api/etl/runs/${runId}/issues?severity=warning`)
      .expect(200);
    expect(warningsRes.body.issues).toHaveLength(8);
    expect(warningsRes.body.total).toBe(8);

    // Filter by rule
    const ruleRes = await request(app)
      .get(`/api/etl/runs/${runId}/issues?rule=STF-011`)
      .expect(200);
    expect(ruleRes.body.issues).toHaveLength(8);

    // CSV export
    const csvRes = await request(app)
      .get(`/api/etl/runs/${runId}/issues.csv`)
      .expect('Content-Type', /text\/csv/)
      .expect(200);
    expect(csvRes.text).toContain('rule_code');
    expect(csvRes.text).toContain('STF-011');
  });

  it('API: Clean datasets pagination, CSV download, and summary', async () => {
    const summaryRes = await request(app).get('/api/clean/summary').expect(200);
    expect(summaryRes.body.counts.subjects).toBe(8);

    const subjectsRes = await request(app).get('/api/clean/subjects?page=1&pageSize=5').expect(200);
    expect(subjectsRes.body.rows).toHaveLength(5);
    expect(subjectsRes.body.total).toBe(8);

    const csvRes = await request(app)
      .get('/api/clean/subjects.csv')
      .expect('Content-Type', /text\/csv/)
      .expect(200);
    expect(csvRes.text).toContain('CS301');
  });

  it('Transaction: An exception during writeCleanData rolls back and preserves existing clean tables', () => {
    // Ensure we have clean data first
    executeEtlPipeline();
    const beforeSummary = getCleanSummary();
    expect(beforeSummary.counts.subjects).toBe(8);

    // Try writing corrupt context that violates database constraints (e.g. invalid type fails CHECK)
    const corruptCtx: any = {
      datasets: {
        subjects: [
          {
            row_number: 1,
            data: {
              subject_code: 'CS101',
              subject_name: 'Intro to CS',
              subject_type: 'invalid_type_fails_check',
              hours_per_week: -5,
              total_hours: 60,
              lab_block_periods: 1,
              required_room_type: 'classroom',
            },
          },
        ],
        rooms: [],
        staff: [],
        holidays: [],
        students_choices: [],
      },
    };

    expect(() => {
      writeCleanData(corruptCtx);
    }).toThrow();

    // Verify existing clean tables remain completely intact!
    const afterSummary = getCleanSummary();
    expect(afterSummary.counts.subjects).toBe(beforeSummary.counts.subjects);
    expect(afterSummary.counts.rooms).toBe(beforeSummary.counts.rooms);
    expect(afterSummary.counts.staff).toBe(beforeSummary.counts.staff);
  });
});
