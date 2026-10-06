import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../server/src/db.js';
import { runSectionSplitter } from '../server/src/services/engine/sectionSplitter.js';
import { runWeeklySolver, getTimetableSlots } from '../server/src/services/engine/solverService.js';
import { validateDatabaseTimetable } from '../server/src/services/engine/engineValidator.js';
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

describe('Module 3 - Part 2: OR-Tools Weekly Timetable Solver', () => {
  beforeAll(() => {
    // 1. Ensure baseline sample data is loaded and validated
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

    // 2. Split sections
    const splitRes = runSectionSplitter();
    expect(splitRes.success).toBe(true);
  });

  it('Criteria 1: OR-Tools CP-SAT solves clean weekly timetable with 0 clashes and matches all hours', async () => {
    const summary = await runWeeklySolver(15);

    expect(['optimal', 'feasible']).toContain(summary.status);
    expect(summary.clash_count).toBe(0);
    expect(summary.slots_count).toBeGreaterThan(0);
    expect(summary.wall_time).toBeLessThan(25);

    const slots = getTimetableSlots();
    expect(slots.length).toBe(summary.slots_count);

    // Run independent database validator
    const report = validateDatabaseTimetable();
    expect(report.valid).toBe(true);
    expect(report.staff_clashes).toBe(0);
    expect(report.room_clashes).toBe(0);
    expect(report.section_clashes).toBe(0);
    expect(report.student_clashes).toBe(0);
    expect(report.capacity_violations).toBe(0);
    expect(report.room_type_violations).toBe(0);
    expect(report.hour_mismatches).toBe(0);
    expect(report.lab_block_violations).toBe(0);
  }, 45000);

  it('Criteria 2: Infeasible case diagnosis: removing lab rooms returns diagnosis in plain words', async () => {
    // Temporarily mark all computer_lab rooms as maintenance
    db.prepare(`UPDATE rooms SET status = 'maintenance' WHERE room_type = 'computer_lab'`).run();

    try {
      const summary = await runWeeklySolver(15);
      expect(summary.status).toBe('infeasible');
      expect(summary.diagnosis).toBeDefined();
      expect(summary.diagnosis?.toLowerCase()).toContain('computer lab');
    } finally {
      // Restore lab rooms
      db.prepare(`UPDATE rooms SET status = 'active' WHERE room_type = 'computer_lab'`).run();
    }
  }, 45000);

  it('Criteria 3: Determinism: two solver runs produce identical schedule and objective', async () => {
    // Run 1
    const run1 = await runWeeklySolver(15);
    const slots1 = getTimetableSlots();

    // Run 2
    const run2 = await runWeeklySolver(15);
    const slots2 = getTimetableSlots();

    expect(run1.status).toBe(run2.status);
    expect(run1.objective).toBe(run2.objective);
    expect(slots1.length).toBe(slots2.length);

    // Compare slot assignments
    const key1 = slots1.map((s) => `${s.section_id}_${s.day_of_week}_${s.period}_${s.room_id}`).sort();
    const key2 = slots2.map((s) => `${s.section_id}_${s.day_of_week}_${s.period}_${s.room_id}`).sort();
    expect(key1).toEqual(key2);
  }, 60000);
});
