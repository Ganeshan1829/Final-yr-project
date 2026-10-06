import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/src/db.js';
import { processAndSaveUpload } from '../server/src/services/uploadService.js';
import { importRulesCsv } from '../server/src/services/rulesService.js';
import { importHolidaysCsv } from '../server/src/services/holidaysService.js';
import { executeEtlPipeline } from '../server/src/etl/runner.js';
import { runSectionSplitter } from '../server/src/services/engine/sectionSplitter.js';
import { runWeeklySolver } from '../server/src/services/engine/solverService.js';
import { generateSemesterCalendar } from '../server/src/services/engine/calendarService.js';
import {
  getDashboardSummary,
  getRoomUse,
  getClashesAnalysis,
  getHoursAnalysis,
  getWorkloadAnalysis,
  getChangesAnalysis,
} from '../server/src/services/dashboard/dashboardService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleDataDir = path.resolve(__dirname, '../sample-data');

describe('Output Layer — Dashboard Analytics & Calculations', () => {
  beforeAll(async () => {
    // 1. Seed sample data
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

    // 2. Run Splitter, Solver, and Calendar Generation
    runSectionSplitter();
    await runWeeklySolver(15);
    generateSemesterCalendar();
  });

  it('Criteria 1: Dashboard Summary returns accurate deterministic KPIs and 0 clashes', () => {
    const summary = getDashboardSummary();

    expect(summary.timetable_status).toBe('generated');
    expect(summary.total_sections).toBeGreaterThan(0);
    expect(summary.total_weekly_periods).toBeGreaterThan(0);
    expect(summary.total_clashes).toBe(0); // MUST be 0 on clean baseline!
    expect(summary.semester_dates).not.toBeNull();
    expect(summary.semester_dates?.semester_name).toBeDefined();

    // Verify against direct SQL
    const actualSecCount = (db.prepare(`SELECT COUNT(*) as c FROM sections`).get() as any).c;
    const actualSlotCount = (db.prepare(`SELECT COUNT(*) as c FROM timetable_slots`).get() as any).c;

    expect(summary.total_sections).toBe(actualSecCount);
    expect(summary.total_weekly_periods).toBe(actualSlotCount);
  });

  it('Criteria 2: Room utilization & heatmap are mathematically exact against working days & periods', () => {
    const roomData = getRoomUse();

    expect(roomData.rooms.length).toBeGreaterThan(0);
    expect(roomData.heatmap.rooms.length).toBe(roomData.rooms.length);
    expect(roomData.heatmap.days.length).toBe(5);
    expect(roomData.heatmap.periods_per_day).toBe(7);

    const availPeriods = 5 * 7; // 35 periods

    for (const r of roomData.rooms) {
      expect(r.available_periods).toBe(availPeriods);
      const expectedPct = Math.round((r.used_periods / availPeriods) * 1000) / 10;
      expect(r.utilization_pct).toBe(expectedPct);
      expect(r.used_periods).toBeLessThanOrEqual(availPeriods);
    }

    expect(roomData.utilization_by_type.overall_avg_pct).toBeGreaterThanOrEqual(0);
    expect(roomData.utilization_by_type.theory_avg_pct).toBeGreaterThanOrEqual(0);
    expect(roomData.utilization_by_type.lab_avg_pct).toBeGreaterThanOrEqual(0);
  });

  it('Criteria 3: Wasted seats analysis accurately computes capacity difference per slot', () => {
    const roomData = getRoomUse();
    const wasted = roomData.wasted_seats;

    expect(wasted.total_seat_periods_wasted).toBeGreaterThanOrEqual(0);
    expect(wasted.average_wasted_seats).toBeGreaterThanOrEqual(0);

    // Verify worst mismatches
    if (wasted.worst_10_mismatches.length > 0) {
      const top = wasted.worst_10_mismatches[0];
      expect(top.wasted_seats).toBe(top.room_capacity - top.section_size);
      expect(top.wasted_pct).toBe(Math.round((top.wasted_seats / top.room_capacity) * 1000) / 10);
    }
  });

  it('Criteria 4: Clash check detects deliberate clash injection and resets on removal', () => {
    // 1. Initial check must be clean
    const cleanClashes = getClashesAnalysis();
    expect(cleanClashes.total_clashes).toBe(0);
    expect(cleanClashes.status).toBe('clean');

    // 2. Inject a deliberate STAFF double-booking clash.
    //    The UNIQUE constraint on timetable_slots is (day_of_week, period, room_id).
    //    A staff clash (same staff, same slot, different room) is valid at the DB level
    //    but detected as a hard-constraint violation by the clash analyser.
    const firstSlot = db.prepare(`SELECT * FROM timetable_slots WHERE staff_id IS NOT NULL LIMIT 1`).get() as any;
    expect(firstSlot).toBeDefined();

    // Find a room that is NOT already occupied at this day/period so the insert
    // doesn't trigger the room-unique constraint either.
    const freeRoom = db.prepare(`
      SELECT r.room_id FROM rooms r
      WHERE r.status = 'active'
        AND r.room_id != ?
        AND r.room_id NOT IN (
          SELECT room_id FROM timetable_slots
          WHERE day_of_week = ? AND period = ?
        )
      LIMIT 1
    `).get(firstSlot.room_id, firstSlot.day_of_week, firstSlot.period) as any;

    expect(freeRoom).toBeDefined();

    // Insert a slot for a dummy section using the same staff but a free room → staff clash
    db.prepare(`
      INSERT INTO timetable_slots (section_id, day_of_week, period, room_id, subject_code, staff_id)
      VALUES (?, ?, ?, ?, 'CLASHTEST', ?)
    `).run(firstSlot.section_id, firstSlot.day_of_week, firstSlot.period, freeRoom.room_id, firstSlot.staff_id);

    const dirtyClashes = getClashesAnalysis();
    expect(dirtyClashes.total_clashes).toBeGreaterThan(0);
    expect(dirtyClashes.status).toBe('has_clashes');
    expect(dirtyClashes.timetable_clashes.staff_clashes).toBeGreaterThan(0);

    // 3. Remove injected clash
    db.prepare(`DELETE FROM timetable_slots WHERE subject_code = 'CLASHTEST'`).run();

    const restoredClashes = getClashesAnalysis();
    expect(restoredClashes.total_clashes).toBe(0);
    expect(restoredClashes.status).toBe('clean');
  });

  it('Criteria 5: Hours analysis matches database hours_summary table exactly', () => {
    const hours = getHoursAnalysis();

    const sqlTotals = db.prepare(`
      SELECT
        SUM(required_hours) as req,
        SUM(delivered_hours) as del,
        SUM(shortfall_hours) as short,
        SUM(makeup_approved_hours) as app
      FROM hours_summary
    `).get() as any;

    expect(hours.totals.required_hours).toBe(sqlTotals.req);
    expect(hours.totals.delivered_hours).toBe(sqlTotals.del);
    expect(hours.totals.shortfall_hours).toBe(sqlTotals.short);
    expect(hours.totals.makeup_approved_hours).toBe(sqlTotals.app || 0);

    // Department grouping
    expect(hours.departments.length).toBeGreaterThan(0);
    for (const d of hours.departments) {
      expect(d.department).toBeDefined();
      expect(d.required_hours).toBeGreaterThan(0);
    }
  });

  it('Criteria 6: Workload and Changes summaries reflect current faculty and change logs', () => {
    const workload = getWorkloadAnalysis();
    expect(workload.staff.length).toBeGreaterThan(0);

    for (const stf of workload.staff) {
      expect(stf.staff_id).toBeDefined();
      expect(stf.max_hours_per_week).toBeGreaterThan(0);
      expect(typeof stf.is_overloaded).toBe('boolean');
    }

    const changes = getChangesAnalysis();
    expect(changes.total_applied).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(changes.recent_log)).toBe(true);
  });
});
