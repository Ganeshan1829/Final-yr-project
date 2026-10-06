import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/src/index.js';
import { db } from '../server/src/db.js';
import { executeTool, executeToolAsync } from '../server/src/services/chatbot/tools.js';
import { processChatMessage } from '../server/src/services/chatbot/llmClient.js';
import { runSectionSplitter } from '../server/src/services/engine/sectionSplitter.js';
import { runWeeklySolver } from '../server/src/services/engine/solverService.js';
import { generateSemesterCalendar } from '../server/src/services/engine/calendarService.js';
import { confirmChange, revertChange } from '../server/src/services/changes/changesService.js';
import { seedSyntheticAllocationHistory } from '../server/src/services/engine/allocationSeedService.js';
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
const HOD = { userId: 'HOD_ADMIN', role: 'hod' as const };

function membership(): string {
  const rows = db.prepare(`SELECT section_id, student_id FROM section_students ORDER BY section_id, student_id`).all() as any[];
  return JSON.stringify(rows);
}

/** A (subject, staff) pair whose subject has at least one other teacher's section, so reallocation is possible. */
function findReallocatableStaff(): { staff_id: string; subject_code: string } | null {
  const row = db
    .prepare(
      `SELECT a.staff_id, a.subject_code FROM sections a
       WHERE EXISTS (SELECT 1 FROM sections b WHERE b.subject_code = a.subject_code AND b.staff_id != a.staff_id)
         AND a.size > 0
       ORDER BY a.size ASC LIMIT 1`
    )
    .get() as any;
  return row ?? null;
}

describe('Teacher-aware allocation, reallocation and tools', () => {
  beforeAll(async () => {
    importRulesCsv(fs.readFileSync(path.join(sampleDataDir, 'rules.csv')));
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
    seedSyntheticAllocationHistory();
    runSectionSplitter();
    await runWeeklySolver(15);
    generateSemesterCalendar();
  }, 120000);

  it('synthetic history is clearly flagged and does not overwrite real feedback', () => {
    const synth = db.prepare(`SELECT COUNT(*) AS c FROM historical_allocations WHERE is_synthetic = 1`).get() as any;
    expect(synth.c).toBeGreaterThan(0);
    const nonFlagged = db.prepare(`SELECT COUNT(*) AS c FROM teacher_feedback WHERE source NOT IN ('synthetic')`).get() as any;
    const before = nonFlagged.c;
    seedSyntheticAllocationHistory();
    const after = (db.prepare(`SELECT COUNT(*) AS c FROM teacher_feedback WHERE source NOT IN ('synthetic')`).get() as any).c;
    expect(after).toBe(before);
  });

  it('every generated section stays within teacher hard cap and room capacity and explains its basis', () => {
    const rows = db.prepare(`SELECT size, allocation_basis FROM sections WHERE allocation_basis IS NOT NULL`).all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const basis = JSON.parse(r.allocation_basis);
      expect(r.size).toBeLessThanOrEqual(basis.hard_cap);
      expect(basis.preferred).toBeGreaterThan(0);
    }
  });

  it('preferences: admin override requires HOD; preferred cannot exceed max', async () => {
    const staff = db.prepare(`SELECT staff_id FROM staff LIMIT 1`).get() as any;
    const denied = await request(app).put('/api/allocation/preferences').send({ staff_id: staff.staff_id, admin_override_max: 80 });
    expect(denied.status).toBe(403);
    const bad = await request(app).put('/api/allocation/preferences').send({ staff_id: staff.staff_id, preferred_class_size: 50, max_class_size: 40 });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .put('/api/allocation/preferences')
      .set('x-user-role', 'hod')
      .send({ staff_id: staff.staff_id, preferred_class_size: 30, max_class_size: 40 });
    expect(ok.status).toBe(200);
    expect(ok.body.preference.max_class_size).toBe(40);
  });

  it('distribution suggestion (no ML) respects hard caps and places every student', async () => {
    const subj = db.prepare(`SELECT subject_code FROM sections GROUP BY subject_code ORDER BY COUNT(*) DESC LIMIT 1`).get() as any;
    const res = await request(app).get(`/api/allocation/distribution/${subj.subject_code}?ml=0`);
    expect(res.status).toBe(200);
    const placed = res.body.teachers.reduce((a: number, t: any) => a + t.students, 0);
    expect(placed + res.body.unallocated).toBe(res.body.total_students);
    for (const t of res.body.teachers) for (const b of t.batch_sizes) expect(b).toBeLessThanOrEqual(Math.min(t.max, res.body.room_capacity));
  });

  it('with no headroom, students stay put and are reported as unresolved (hard caps are never exceeded)', () => {
    const target = findReallocatableStaff();
    expect(target).not.toBeNull();
    const before = membership();
    const whatIf = executeTool('simulate_teacher_allocation', { unavailable_staff_ids: [target!.staff_id], subject_codes: [target!.subject_code] }, HOD);
    expect(whatIf.success).toBe(true);
    expect(whatIf.isWhatIf).toBe(true);
    expect(whatIf.preview.change_id).toBeNull();
    expect(membership()).toBe(before);

    const plan = whatIf.preview.impact_summary.reallocation;
    for (const subj of plan.subjects) {
      for (const sec of subj.sections.filter((o: any) => o.role === 'target')) expect(sec.after).toBeLessThanOrEqual(sec.hard_cap);
      expect(subj.placed + subj.unresolved).toBe(subj.displaced);
    }
    // every student who cannot move is explained by a concrete cause (not a generic "at capacity" message)
    for (const u of plan.unresolved) expect(['schedule_clash', 'capacity', 'no_section']).toContain(u.cause);
    if (plan.unresolved.some((u: any) => u.cause === 'schedule_clash')) {
      expect(plan.warnings.join(' ')).toMatch(/already have another class/);
    }
  });

  it('with headroom: what-if/staging change nothing, confirm moves students within limits, revert is exact', () => {
    const target = findReallocatableStaff();
    expect(target).not.toBeNull();

    // Give the OTHER teachers' sections real headroom: bigger rooms + an explicit HOD override of the teacher max.
    const others = db
      .prepare(`SELECT section_id, staff_id FROM sections WHERE subject_code = ? AND staff_id != ?`)
      .all(target!.subject_code, target!.staff_id) as any[];
    const roomRows = db
      .prepare(`SELECT DISTINCT r.room_id, r.capacity FROM timetable_slots ts JOIN rooms r ON r.room_id = ts.room_id WHERE ts.section_id IN (${others.map(() => '?').join(',')})`)
      .all(...others.map((o) => o.section_id)) as any[];
    const upRoom = db.prepare(`UPDATE rooms SET capacity = ? WHERE room_id = ?`);
    const insOverride = db.prepare(
      `INSERT INTO teacher_preferences (staff_id, subject_code, preferred_class_size, max_class_size, admin_override_max, source, updated_at)
       VALUES (?, ?, 40, 60, 500, 'admin', ?) ON CONFLICT(staff_id, subject_code) DO UPDATE SET admin_override_max = 500, source = 'admin'`
    );
    for (const r of roomRows) upRoom.run(r.capacity + 40, r.room_id);
    for (const o of others) insOverride.run(o.staff_id, target!.subject_code, new Date().toISOString());

    try {
      const before = membership();
      const whatIf = executeTool('simulate_teacher_allocation', { unavailable_staff_ids: [target!.staff_id], subject_codes: [target!.subject_code] }, HOD);
      expect(whatIf.preview.change_id).toBeNull();
      expect(membership()).toBe(before);

      const staged = executeTool('simulate_teacher_allocation', { unavailable_staff_ids: [target!.staff_id], subject_codes: [target!.subject_code], stage: true }, HOD);
      expect(staged.preview.change_id).toBeGreaterThan(0);
      expect(membership()).toBe(before); // staging alone must never modify data

      const plan = staged.preview.impact_summary.reallocation;
      expect(plan.moves.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const m of plan.moves) {
        expect(seen.has(m.student_id)).toBe(false);
        seen.add(m.student_id);
        expect(m.to_staff_id).not.toBe(target!.staff_id);
      }
      for (const subj of plan.subjects) {
        for (const sec of subj.sections.filter((o: any) => o.role === 'target')) expect(sec.after).toBeLessThanOrEqual(sec.hard_cap);
      }

      confirmChange(staged.preview.change_id, 'HOD');
      expect(membership()).not.toBe(before);
      const sizes = db.prepare(`SELECT s.size, (SELECT COUNT(*) FROM section_students ss WHERE ss.section_id = s.section_id) AS n FROM sections s`).all() as any[];
      for (const r of sizes) expect(r.size).toBe(r.n);

      // a second confirm of the same (now applied) change is rejected
      expect(() => confirmChange(staged.preview.change_id, 'HOD')).toThrow();

      revertChange(staged.preview.change_id, 'HOD');
      expect(membership()).toBe(before);
    } finally {
      for (const r of roomRows) upRoom.run(r.capacity, r.room_id);
      db.prepare(`DELETE FROM teacher_preferences WHERE admin_override_max = 500 AND source = 'admin'`).run();
    }
  });

  it('roles: students and staff cannot use allocation tools', async () => {
    const stu = executeTool('simulate_teacher_allocation', { unavailable_staff_ids: ['STF001'] }, { userId: 'STU001', role: 'student' });
    expect(stu.denied).toBe(true);
    const staff = await executeToolAsync('suggest_student_distribution', { subject_code: 'X' }, { userId: 'STF001', role: 'staff' });
    expect(staff.denied).toBe(true);
  });

  it('zod validation rejects malformed allocation tool arguments', () => {
    const res = executeTool('simulate_teacher_allocation', { unavailable_staff_ids: [] }, HOD);
    expect(res.success).toBe(false);
    expect(res.message).toContain('Tool execution failed');
  });

  it('predict_class_demand degrades gracefully when the ML service is offline', async () => {
    const res = await executeToolAsync('predict_class_demand', {}, HOD);
    // Either the ML service is running (success) or it is offline and the tool reports it without throwing.
    if (!res.success) expect(res.message).toMatch(/ML prediction unavailable/);
    else expect((res.result as any).stored).toBeGreaterThan(0);
  });

  it('chatbot "stage" request creates a confirmable draft but changes nothing until confirmed', async () => {
    const target = findReallocatableStaff();
    expect(target).not.toBeNull();
    const before = membership();
    const reply = await processChatMessage(`Please stage a redistribution of ${target!.staff_id} students for ${target!.subject_code}`, [], HOD);
    expect(reply.tool_call?.name).toBe('simulate_teacher_allocation');
    expect(reply.is_what_if).toBe(false);
    const changeId = (reply.preview as any)?.change_id;
    expect(changeId).toBeGreaterThan(0);
    expect(membership()).toBe(before);
    const row = db.prepare(`SELECT status, type FROM changes WHERE id = ?`).get(changeId) as any;
    expect(row).toMatchObject({ status: 'previewed', type: 'reallocation' });
    // a student cannot stage-and-confirm: role check blocks the tool before anything is created
    const denied = await processChatMessage(`stage a redistribution of ${target!.staff_id}`, [], { userId: 'STU001', role: 'student' });
    expect(denied.preview).toBeUndefined();
    // HOD discards the draft; still no data change
    const res = await request(app).post(`/api/changes/${changeId}/discard`).set('x-user-role', 'hod');
    expect(res.status).toBe(200);
    expect(membership()).toBe(before);
  });

  it('chatbot routes a leave-redistribution question to the allocation tool (preview, no commit)', async () => {
    const target = findReallocatableStaff();
    if (!target) return;
    const before = membership();
    const reply = await processChatMessage(`If ${target.staff_id} takes leave tomorrow, how can we redistribute his students?`, [], HOD);
    expect(reply.tool_call?.name).toBe('simulate_teacher_allocation');
    expect(reply.is_what_if).toBe(true);
    expect(membership()).toBe(before);
  });
});
