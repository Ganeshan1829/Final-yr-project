import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../server/src/db.js';
import { runSectionSplitter } from '../server/src/services/engine/sectionSplitter.js';
import { runWeeklySolver } from '../server/src/services/engine/solverService.js';
import {
  generateSemesterCalendar,
  getCalendarSessions,
  getHoursSummary,
  getSuggestedMakeups,
  updateMakeupStatus,
  exportTimetableCsv,
  exportHoursSummaryCsv,
} from '../server/src/services/engine/calendarService.js';
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

describe('Module 3 - Part 3: Calendar Expansion & Hours Check', () => {
  beforeAll(async () => {
    // 1. Ensure baseline sample data is loaded and validated
    const rulesBuf = fs.readFileSync(path.join(sampleDataDir, 'rules.csv'));
    importRulesCsv(rulesBuf);

    for (const ds of ['students_choices', 'subjects', 'rooms', 'staff', 'holidays']) {
      const p = path.join(sampleDataDir, `${ds}.csv`);
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        processAndSaveUpload(ds, `${ds}.csv`, buf);
        if (ds === 'holidays') {
          try {
            importHolidaysCsv(buf);
          } catch {}
        }
      }
    }

    // Load events
    const eventsPath = path.join(sampleDataDir, 'events.csv');
    if (fs.existsSync(eventsPath)) {
      const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').slice(1);
      const insertEvt = db.prepare(`
        INSERT OR REPLACE INTO events (
          event_id, event_name, event_type, date, start_period, end_period, venue_room_id, staff_involved, student_scope, expected_attendance, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 10) {
          insertEvt.run(parts[0], parts[1], parts[2], parts[3], Number(parts[4]), Number(parts[5]), parts[6], parts[7], parts[8], Number(parts[9]));
        }
      }
    }

    // Load leave
    const leavePath = path.join(sampleDataDir, 'leave.csv');
    if (fs.existsSync(leavePath)) {
      const lines = fs.readFileSync(leavePath, 'utf-8').trim().split('\n').slice(1);
      const insertLev = db.prepare(`
        INSERT OR REPLACE INTO leave (
          leave_id, staff_id, date_from, date_to, leave_type, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 7) {
          insertLev.run(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]);
        }
      }
    }

    executeEtlPipeline();

    // 2. Split sections
    const splitRes = runSectionSplitter();
    expect(splitRes.success).toBe(true);

    // 3. Solve weekly timetable
    const solverRes = await runWeeklySolver(15);
    expect(['optimal', 'feasible']).toContain(solverRes.status);
  }, 90000);

  it('Criteria 1: Calendar generation expands weekly timetable and skips holidays/events', () => {
    const summary = generateSemesterCalendar();
    expect(summary.success).toBe(true);
    expect(summary.total_dates).toBeGreaterThan(50);
    expect(summary.total_sessions).toBeGreaterThan(0);
    expect(summary.scheduled_count).toBeGreaterThan(0);

    // Check sessions in DB
    const sessions = getCalendarSessions();
    expect(sessions.length).toBe(summary.total_sessions);

    // Check holiday skipping
    const holidaySessions = sessions.filter((s) => s.status === 'skipped_holiday');
    expect(holidaySessions.length).toBe(summary.holiday_skipped_count);
    if (holidaySessions.length > 0) {
      expect(holidaySessions[0].notes).toBeDefined();
    }
  });

  it('Criteria 2: Hours summary tracks required vs delivered with shortfall math', () => {
    const hours = getHoursSummary();
    expect(hours.length).toBeGreaterThan(0);

    for (const row of hours) {
      expect(row.required_hours).toBeGreaterThan(0);
      expect(row.delivered_hours).toBeGreaterThanOrEqual(0);
      expect(row.shortfall_hours).toBe(Math.max(0, row.required_hours - row.delivered_hours));
      expect(row.makeup_approved_hours).toBeGreaterThanOrEqual(0);
    }
  });

  it('Criteria 3: Suggested make-ups can be approved, reducing shortfall and adding session', () => {
    const makeups = getSuggestedMakeups({ status: 'suggested' });
    if (makeups.length > 0) {
      const target = makeups[0];
      const hoursBefore = getHoursSummary().find((h) => h.section_id === target.section_id);
      const initialShortfall = hoursBefore?.shortfall_hours || 0;

      // Approve makeup
      const approved = updateMakeupStatus(target.id, 'approve');
      expect(approved.status).toBe('approved');

      // Verify a makeup calendar session was added
      const makeupSessions = getCalendarSessions({ section_id: target.section_id }).filter(
        (s) => s.status === 'makeup' && s.session_date === target.makeup_date && s.period === target.period
      );
      expect(makeupSessions.length).toBe(1);

      // Verify shortfall decreased
      const hoursAfter = getHoursSummary().find((h) => h.section_id === target.section_id);
      if (initialShortfall > 0) {
        expect(hoursAfter?.shortfall_hours).toBe(initialShortfall - 1);
        expect(hoursAfter?.makeup_approved_hours).toBe((hoursBefore?.makeup_approved_hours || 0) + 1);
      }
    }
  });

  it('Criteria 4: Rejecting a makeup updates status without adding makeup session', () => {
    const makeups = getSuggestedMakeups({ status: 'suggested' });
    if (makeups.length > 0) {
      const target = makeups[0];
      const rejected = updateMakeupStatus(target.id, 'reject');
      expect(rejected.status).toBe('rejected');

      const makeupSessions = getCalendarSessions({ section_id: target.section_id }).filter(
        (s) => s.status === 'makeup' && s.session_date === target.makeup_date && s.period === target.period
      );
      expect(makeupSessions.length).toBe(0);
    }
  });

  it('Criteria 5: CSV exports produce valid header and row formatting', () => {
    const timetableCsv = exportTimetableCsv();
    expect(timetableCsv).toContain('day,period,start_time,end_time,subject_code,subject_name,section_label');

    const hoursCsv = exportHoursSummaryCsv();
    expect(hoursCsv).toContain('section_label,subject_code,subject_name,staff_name,required_hours,delivered_hours,shortfall_hours');
  });
});
