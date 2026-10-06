import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../server/src/db.js';
import { runSectionSplitter, getSections, editSectionSize } from '../server/src/services/engine/sectionSplitter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAndSaveUpload } from '../server/src/services/uploadService.js';
import { importRulesCsv } from '../server/src/services/rulesService.js';
import { importHolidaysCsv } from '../server/src/services/holidaysService.js';
import { executeEtlPipeline } from '../server/src/etl/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../sample-data');

describe('Module 3 - Part 1: Section Splitter', () => {
  beforeAll(() => {
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
    executeEtlPipeline();
  });

  beforeEach(() => {
    // Ensure clean state before tests
    db.prepare(`UPDATE engine_state SET split_status = 'not_run', stale = 0 WHERE id = 1`).run();
  });

  it('Criteria 1: Equal split across qualified staff respecting student choices', () => {
    const res = runSectionSplitter();
    expect(res.success).toBe(true);
    expect(res.total_sections).toBeGreaterThan(0);
    expect(res.total_students_assigned).toBeGreaterThan(0);

    const sections = getSections();
    expect(sections.length).toBe(res.total_sections);

    // In sample data CS301 has 160 students picking STF001, STF004, STF008, STF012 (40 each)
    const cs301Sections = sections.filter((s) => s.subject_code === 'CS301');
    expect(cs301Sections.length).toBe(4);
    for (const sec of cs301Sections) {
      expect(sec.size).toBe(40);
      expect(sec.required_room_type).toBe('classroom');
      expect(sec.hours_per_week).toBe(4);
      expect(sec.is_lab).toBe(0);
    }
  });

  it('Criteria 2: Idempotent rerun replaces previous sections without duplication', () => {
    const res1 = runSectionSplitter();
    const count1 = (db.prepare('SELECT count(*) as c FROM sections').get() as any).c;
    const stuCount1 = (db.prepare('SELECT count(*) as c FROM section_students').get() as any).c;

    // Run again
    const res2 = runSectionSplitter();
    const count2 = (db.prepare('SELECT count(*) as c FROM sections').get() as any).c;
    const stuCount2 = (db.prepare('SELECT count(*) as c FROM section_students').get() as any).c;

    expect(count1).toBe(count2);
    expect(stuCount1).toBe(stuCount2);
    expect(res1.total_sections).toBe(res2.total_sections);
  });

  it('Criteria 3: Below minimum section size flags a warning but creates one section', () => {
    // Insert a test elective subject with only 15 students
    db.prepare(`
      INSERT OR REPLACE INTO subjects (
        subject_code, subject_name, subject_type, credits, hours_per_week, total_hours, lab_block_periods, required_room_type, department, semester
      ) VALUES ('TEST101', 'Special Elective', 'theory', 3, 3, 45, 0, 'classroom', 'Computer Science & Engineering', 5)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO staff_subjects (staff_id, subject_code)
      VALUES ('STF001', 'TEST101')
    `).run();

    // Insert only 15 student choices (min section size is 30)
    for (let i = 1; i <= 15; i++) {
      const stuId = `STU${String(i).padStart(4, '0')}`;
      db.prepare(`
        INSERT OR REPLACE INTO student_choices (
          student_id, subject_code, staff_id, selected_at, selection_order
        ) VALUES (?, 'TEST101', 'STF001', '2026-06-15 10:00:00', 1)
      `).run(stuId);
    }

    const res = runSectionSplitter();
    const testSec = res.sections.find((s) => s.subject_code === 'TEST101');
    expect(testSec).toBeDefined();
    expect(testSec?.size).toBe(15);
    expect(testSec?.warning_message).toContain('below minimum');
    expect(res.warnings.some((w) => w.includes('TEST101') && w.includes('below minimum'))).toBe(true);

    // Clean up test data
    db.prepare(`DELETE FROM student_choices WHERE subject_code = 'TEST101'`).run();
    db.prepare(`DELETE FROM staff_subjects WHERE subject_code = 'TEST101'`).run();
    db.prepare(`DELETE FROM section_students WHERE section_id IN (SELECT section_id FROM sections WHERE subject_code = 'TEST101')`).run();
    db.prepare(`DELETE FROM sections WHERE subject_code = 'TEST101'`).run();
    db.prepare(`DELETE FROM subjects WHERE subject_code = 'TEST101'`).run();
    runSectionSplitter();
  });

  it('Criteria 4: Staff shortfall error when qualified staff are fewer than needed for max section size', () => {
    // 200 students picking a subject where only 1 staff is qualified (max section size is 70)
    // 200 / 70 = 3 staff needed, but only 1 available!
    db.prepare(`
      INSERT OR REPLACE INTO subjects (
        subject_code, subject_name, subject_type, credits, hours_per_week, total_hours, lab_block_periods, required_room_type, department, semester
      ) VALUES ('OVER101', 'Overenrolled Course', 'theory', 3, 3, 45, 0, 'classroom', 'Computer Science & Engineering', 5)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO staff_subjects (staff_id, subject_code)
      VALUES ('STF001', 'OVER101')
    `).run();

    for (let i = 1; i <= 150; i++) {
      const stuId = `STU${String(i).padStart(4, '0')}`;
      db.prepare(`
        INSERT OR REPLACE INTO student_choices (
          student_id, subject_code, staff_id, selected_at, selection_order
        ) VALUES (?, 'OVER101', 'STF001', '2026-06-15 10:00:00', 1)
      `).run(stuId);
    }

    const res = runSectionSplitter();
    expect(res.errors.some((e) => e.includes('Staff shortfall') && e.includes('OVER101'))).toBe(true);

    // Clean up
    db.prepare(`DELETE FROM student_choices WHERE subject_code = 'OVER101'`).run();
    db.prepare(`DELETE FROM staff_subjects WHERE subject_code = 'OVER101'`).run();
    db.prepare(`DELETE FROM section_students WHERE section_id IN (SELECT section_id FROM sections WHERE subject_code = 'OVER101')`).run();
    db.prepare(`DELETE FROM sections WHERE subject_code = 'OVER101'`).run();
    db.prepare(`DELETE FROM subjects WHERE subject_code = 'OVER101'`).run();
    runSectionSplitter();
  });

  it('Criteria 5: Manual section size edit with preview and confirm marks downstream timetable stale', () => {
    runSectionSplitter();
    const sections = getSections();
    const sec = sections[0];

    // Preview
    const previewRes = editSectionSize(sec.section_id, 45, false);
    expect(previewRes.preview).toBe(true);
    expect(previewRes.old_size).toBe(sec.size);
    expect(previewRes.new_size).toBe(45);
    expect(previewRes.room_capacity_ok).toBe(true);

    // Confirm save
    const confirmRes = editSectionSize(sec.section_id, 45, true);
    expect(confirmRes.preview).toBe(false);
    expect(confirmRes.section.size).toBe(45);

    // Downstream state must be marked stale!
    const engineState = db.prepare(`SELECT * FROM engine_state WHERE id = 1`).get() as any;
    expect(engineState.stale).toBe(1);
    expect(engineState.solve_status).toBe('stale');
    expect(engineState.calendar_status).toBe('stale');
  });
});
