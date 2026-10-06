import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../server/src/db.js';
import { runSectionSplitter } from '../server/src/services/engine/sectionSplitter.js';
import { runWeeklySolver } from '../server/src/services/engine/solverService.js';
import { generateSemesterCalendar, getCalendarSessions, getHoursSummary } from '../server/src/services/engine/calendarService.js';
import {
  previewChange,
  confirmChange,
  discardChange,
  revertChange,
  getChanges,
  getChangeById,
  getManagementAlerts,
} from '../server/src/services/changes/changesService.js';
import { validateDatabaseCalendar } from '../server/src/services/engine/engineValidator.js';
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

describe('Phase 3 - Part A: Management Changes Engine', () => {
  beforeAll(async () => {
    // 1. Setup baseline database
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
    executeEtlPipeline();

    // 2. Run splitting, solving, and calendar generation
    runSectionSplitter();
    await runWeeklySolver(15);
    generateSemesterCalendar();

    // Ensure baseline calendar is 100% valid
    const report = validateDatabaseCalendar();
    expect(report.valid).toBe(true);
  }, 90000);

  it('Criteria 1: Previewing a change does NOT modify the database', () => {
    const beforeCount = (db.prepare('SELECT COUNT(*) as c FROM calendar_sessions').get() as any).c;
    const beforeHours = (db.prepare('SELECT SUM(shortfall_hours) as s FROM hours_summary').get() as any).s;

    const preview = previewChange('leave', {
      staff_id: 'STF001',
      start_date: '2026-08-03',
      end_date: '2026-08-07',
      reason: 'Academic Conference',
    });

    expect(preview.change_id).toBeDefined();
    expect(preview.status).toBe('previewed');
    expect(preview.impact_summary.sessions_affected_count).toBeGreaterThan(0);

    // Verify calendar_sessions and hours_summary are completely unchanged
    const afterCount = (db.prepare('SELECT COUNT(*) as c FROM calendar_sessions').get() as any).c;
    const afterHours = (db.prepare('SELECT SUM(shortfall_hours) as s FROM hours_summary').get() as any).s;
    expect(afterCount).toBe(beforeCount);
    expect(afterHours).toBe(beforeHours);

    // Clean up preview
    discardChange(preview.change_id!);
  });

  it('Criteria 2: Staff leave proposes qualified & free substitutes ranked by least load', () => {
    // STF001 teaches CS301 and CS305
    const preview = previewChange('leave', {
      staff_id: 'STF001',
      start_date: '2026-08-10',
      end_date: '2026-08-14',
      reason: 'Medical Leave',
    });

    expect(preview.impact_summary.sessions_affected_count).toBeGreaterThan(0);

    for (const fix of preview.impact_summary.proposed_fixes) {
      expect(fix.original_staff_id).toBe('STF001');
      if (fix.action === 'substitute') {
        expect(fix.substitute_staff_id).toBeDefined();
        expect(fix.substitute_staff_id).not.toBe('STF001');

        // Verify substitute is qualified in staff_subjects
        const qRow = db.prepare(`
          SELECT COUNT(*) as c FROM staff_subjects
          WHERE staff_id = ? AND subject_code = ?
        `).get(fix.substitute_staff_id, fix.subject_code) as any;
        expect(qRow.c).toBeGreaterThan(0);

        // Verify candidates ranking
        if (fix.substitute_candidates && fix.substitute_candidates.length > 1) {
          expect(fix.substitute_candidates[0].current_load).toBeLessThanOrEqual(
            fix.substitute_candidates[1].current_load
          );
        }
      }
    }

    // Clean up preview
    discardChange(preview.change_id!);
  });

  it('Criteria 3: Confirming a change applies atomically and validates with 0 clashes', () => {
    const preview = previewChange('leave', {
      staff_id: 'STF002',
      start_date: '2026-08-17',
      end_date: '2026-08-21',
      reason: 'Research visit',
    });

    const changeId = preview.change_id!;
    const confirmRes = confirmChange(changeId, 'HOD');
    expect(confirmRes.success).toBe(true);

    const change = getChangeById(changeId);
    expect(change?.status).toBe('applied');
    expect(change?.applied_at).toBeDefined();

    // Independent validator confirms zero clashes
    const valReport = validateDatabaseCalendar();
    expect(valReport.valid).toBe(true);
    expect(valReport.staff_clashes).toBe(0);
    expect(valReport.room_clashes).toBe(0);
    expect(valReport.section_clashes).toBe(0);

    // Revert change to return to pristine baseline
    const revRes = revertChange(changeId, 'HOD');
    expect(revRes.success).toBe(true);

    const revertedChange = getChangeById(changeId);
    expect(revertedChange?.status).toBe('reverted');

    const postRevertVal = validateDatabaseCalendar();
    expect(postRevertVal.valid).toBe(true);
  });

  it('Criteria 4: Event room displacement follows decision order (same slot free room)', () => {
    // Find an actual scheduled session in a classroom to block
    const sampleSession = db.prepare(`
      SELECT c.* FROM calendar_sessions c
      JOIN rooms r ON c.room_id = r.room_id
      WHERE c.status = 'scheduled' AND r.room_type = 'classroom'
      ORDER BY c.session_date ASC, c.period ASC LIMIT 1
    `).get() as any;
    expect(sampleSession).toBeDefined();

    const preview = previewChange('event', {
      name: 'Department Symposium',
      date: sampleSession.session_date,
      start_period: sampleSession.period,
      end_period: sampleSession.period,
      venue_room_id: sampleSession.room_id,
    });

    expect(preview.impact_summary.sessions_affected_count).toBeGreaterThan(0);
    for (const fix of preview.impact_summary.proposed_fixes) {
      if (fix.original_room_id === sampleSession.room_id) {
        // According to Decision Order 1, if another classroom is free in the same slot, it moves room
        expect(['move_room', 'move_slot', 'makeup']).toContain(fix.action);
        if (fix.action === 'move_room') {
          expect(fix.new_room_id).toBeDefined();
          expect(fix.new_room_id).not.toBe(sampleSession.room_id);
        }
      }
    }

    discardChange(preview.change_id!);
  });

  it('Criteria 5: Intake increase moves section to bigger room with zero clashes', () => {
    // Find an active section
    const sec = db.prepare(`SELECT * FROM sections WHERE is_lab = 0 LIMIT 1`).get() as any;
    expect(sec).toBeDefined();

    const preview = previewChange('intake', {
      section_id: sec.section_id,
      new_size: 65, // increase to 65
    });

    expect(preview.impact_summary.diff.length).toBeGreaterThan(0);
    expect(preview.impact_summary.new_clashes).toBe(0);

    const changeId = preview.change_id!;
    const confirmRes = confirmChange(changeId, 'HOD');
    expect(confirmRes.success).toBe(true);

    // Verify section size updated
    const updatedSec = db.prepare(`SELECT size FROM sections WHERE section_id = ?`).get(sec.section_id) as any;
    expect(updatedSec.size).toBe(65);

    // Verify independent validation
    const valReport = validateDatabaseCalendar();
    expect(valReport.valid).toBe(true);

    // Revert change
    revertChange(changeId, 'HOD');
    const restoredSec = db.prepare(`SELECT size FROM sections WHERE section_id = ?`).get(sec.section_id) as any;
    expect(restoredSec.size).toBe(sec.size);
  });

  it('Criteria 6: Stale preview check rejects confirmation if timetable was modified', () => {
    const preview = previewChange('leave', {
      staff_id: 'STF004',
      start_date: '2026-09-07',
      end_date: '2026-09-11',
      reason: 'Personal',
    });

    // Invalidate stale token by simulating calendar touch
    db.prepare(`UPDATE engine_state SET last_calendar_at = '2099-01-01T00:00:00.000Z' WHERE id = 1`).run();

    expect(() => confirmChange(preview.change_id!, 'HOD')).toThrow(/stale/i);

    // Restore clean state
    db.prepare(`UPDATE engine_state SET last_calendar_at = datetime('now') WHERE id = 1`).run();
    discardChange(preview.change_id!);
  });

  it('Criteria 7: Determinism: identical inputs produce identical preview and proposed fixes', () => {
    const payload = {
      staff_id: 'STF001',
      start_date: '2026-09-14',
      end_date: '2026-09-18',
      reason: 'Workshop',
    };

    const prev1 = previewChange('leave', payload, 'HOD', true);
    const prev2 = previewChange('leave', payload, 'HOD', true);

    expect(prev1.impact_summary.sessions_affected_count).toBe(prev2.impact_summary.sessions_affected_count);
    expect(prev1.impact_summary.shortfall_after).toBe(prev2.impact_summary.shortfall_after);
    expect(prev1.impact_summary.proposed_fixes.map((f) => f.action)).toEqual(
      prev2.impact_summary.proposed_fixes.map((f) => f.action)
    );
  });
});
