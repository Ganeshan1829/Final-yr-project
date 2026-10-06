import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db } from '../../db.js';
import { getStoredRules } from '../rulesService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In-memory status for live solver polling
let solverRunning = false;
let solverProgress = 0;
let solverLatestResult = null;
let solverError = null;
export function getSolverStatus() {
    return {
        isRunning: solverRunning,
        progress: solverProgress,
        latestResult: solverLatestResult,
        error: solverError,
    };
}
/**
 * Checks if python and ortools are installed in the host environment.
 */
export async function checkPythonEnvironment() {
    return new Promise((resolve) => {
        const proc = spawn('python', ['-c', 'import ortools; print(ortools.__version__)']);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => {
            stdout += d.toString();
        });
        proc.stderr.on('data', (d) => {
            stderr += d.toString();
        });
        proc.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                resolve({ ready: true, version: stdout.trim() });
            }
            else {
                resolve({
                    ready: false,
                    error: stderr.trim() ||
                        'Python or Google OR-Tools is not installed or not in PATH. Please install python and run `pip install -r server/engine/requirements.txt`.',
                });
            }
        });
        proc.on('error', (err) => {
            resolve({
                ready: false,
                error: `Failed to execute python: ${err.message}. Please install Python 3.10+ and Google OR-Tools.`,
            });
        });
    });
}
/**
 * Runs OR-Tools Weekly Timetable Solver.
 * Returns SolverRunSummary.
 */
export async function runWeeklySolver(timeLimitSeconds = 60) {
    if (solverRunning) {
        throw new Error('A timetable solver run is already in progress.');
    }
    // 1. Check clean validation & sections existence
    const secStmt = db.prepare(`SELECT * FROM sections ORDER BY section_id ASC`);
    const sections = secStmt.all();
    if (sections.length === 0) {
        throw new Error('No sections found. Please run the Section Splitter (Step 1) before generating the timetable.');
    }
    // 2. Check python environment
    const pyCheck = await checkPythonEnvironment();
    if (!pyCheck.ready) {
        throw new Error(pyCheck.error);
    }
    solverRunning = true;
    solverProgress = 10;
    solverError = null;
    try {
        // 3. Assemble solver input payload
        const { rules } = getStoredRules();
        const workingDays = rules?.working_days || ['MON', 'TUE', 'WED', 'THU', 'FRI'];
        const periodsPerDay = rules?.periods_per_day || 7;
        const roomsStmt = db.prepare(`SELECT * FROM rooms WHERE status = 'active' ORDER BY capacity ASC`);
        const rooms = roomsStmt.all();
        // Calculate student conflicts: pairs of sections that share at least 1 student
        const conflictsStmt = db.prepare(`
      SELECT DISTINCT a.section_id as s1, b.section_id as s2
      FROM section_students a
      JOIN section_students b ON a.student_id = b.student_id AND a.section_id < b.section_id
    `);
        const conflictRows = conflictsStmt.all();
        const studentConflicts = conflictRows.map((r) => [r.s1, r.s2]);
        // Check pinned slots
        const pinnedStmt = db.prepare(`SELECT * FROM timetable_slots WHERE is_pinned = 1`);
        const pinnedSlots = pinnedStmt.all();
        // Load config weights and solver params
        let weights = {
            wasted_seats: 1,
            staff_gaps: 5,
            staff_consecutive_excess: 10,
            subject_daily_repeat: 8,
            late_period_load: 2,
        };
        let numWorkers = 1;
        let randomSeed = 42;
        const configPath = path.resolve(__dirname, '../../../engine/solver_config.json');
        if (fs.existsSync(configPath)) {
            try {
                const conf = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (conf.weights)
                    weights = conf.weights;
                if (conf.num_workers !== undefined)
                    numWorkers = conf.num_workers;
                if (conf.random_seed !== undefined)
                    randomSeed = conf.random_seed;
            }
            catch {
                // use default
            }
        }
        const payload = {
            sections: sections.map((s) => ({
                id: s.section_id,
                subject_code: s.subject_code,
                staff_id: s.staff_id,
                section_label: s.section_label,
                size: s.size,
                required_room_type: s.required_room_type || 'classroom',
                hours_per_week: s.hours_per_week,
                is_lab: s.is_lab,
                lab_block_periods: s.is_lab ? 3 : 0,
            })),
            rooms: rooms.map((r) => ({
                room_id: r.room_id,
                room_name: r.room_name,
                capacity: r.capacity,
                room_type: r.room_type,
                status: r.status,
            })),
            rules: {
                working_days: workingDays,
                periods_per_day: periodsPerDay,
                max_consecutive_theory_periods: rules?.max_consecutive_theory_periods || 2,
                max_staff_periods_per_day: rules?.max_staff_periods_per_day || 4,
            },
            student_conflicts: studentConflicts,
            pinned_slots: pinnedSlots.map((p) => ({
                section_id: p.section_id,
                day_of_week: p.day_of_week,
                period: p.period,
                room_id: p.room_id,
            })),
            weights,
            params: {
                time_limit_seconds: timeLimitSeconds,
                num_workers: numWorkers,
                random_seed: randomSeed,
            },
        };
        solverProgress = 30;
        // 4. Invoke server/engine/solve_week.py via child_process with temp files
        const engineScript = path.resolve(__dirname, '../../../engine/solve_week.py');
        const tmpInput = path.resolve(__dirname, `../../../engine/tmp_input_${Date.now()}.json`);
        const tmpOutput = path.resolve(__dirname, `../../../engine/tmp_output_${Date.now()}.json`);
        fs.writeFileSync(tmpInput, JSON.stringify(payload, null, 2), 'utf-8');
        solverProgress = 50;
        const solverResult = await new Promise((resolve, reject) => {
            const proc = spawn('python', [engineScript, '--input', tmpInput, '--output', tmpOutput]);
            let stderr = '';
            proc.stderr.on('data', (d) => {
                stderr += d.toString();
            });
            proc.on('close', (code) => {
                try {
                    if (fs.existsSync(tmpInput))
                        fs.unlinkSync(tmpInput);
                }
                catch {
                    // ignore
                }
                if (code !== 0) {
                    try {
                        if (fs.existsSync(tmpOutput))
                            fs.unlinkSync(tmpOutput);
                    }
                    catch {
                        // ignore
                    }
                    return reject(new Error(`OR-Tools solver process failed with exit code ${code}: ${stderr}`));
                }
                if (!fs.existsSync(tmpOutput)) {
                    return reject(new Error('OR-Tools solver completed but did not produce output file.'));
                }
                try {
                    const outData = JSON.parse(fs.readFileSync(tmpOutput, 'utf-8'));
                    fs.unlinkSync(tmpOutput);
                    resolve(outData);
                }
                catch (e) {
                    reject(new Error(`Failed to parse solver output: ${e.message}`));
                }
            });
            proc.on('error', (err) => {
                try {
                    if (fs.existsSync(tmpInput))
                        fs.unlinkSync(tmpInput);
                    if (fs.existsSync(tmpOutput))
                        fs.unlinkSync(tmpOutput);
                }
                catch {
                    // ignore
                }
                reject(err);
            });
        });
        solverProgress = 85;
        // 5. Store solver run & slots in database transaction
        const now = new Date().toISOString();
        const isSuccess = solverResult.status === 'optimal' || solverResult.status === 'feasible';
        const totalClashes = (solverResult.clashes?.room_clashes || 0) +
            (solverResult.clashes?.staff_clashes || 0) +
            (solverResult.clashes?.section_clashes || 0);
        db.exec('BEGIN TRANSACTION;');
        try {
            const runStmt = db.prepare(`
        INSERT INTO solver_runs (
          status, objective, wall_time, created_at, params, diagnosis, clash_count, wasted_seats
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const runRes = runStmt.run(solverResult.status, solverResult.objective, solverResult.wall_time, now, JSON.stringify(payload.params), solverResult.diagnosis, totalClashes, solverResult.wasted_seats || 0);
            const runId = Number(runRes.lastInsertRowid);
            if (isSuccess && Array.isArray(solverResult.slots)) {
                // Clear unpinned slots
                db.exec(`DELETE FROM timetable_slots WHERE is_pinned = 0`);
                const insertSlotStmt = db.prepare(`
          INSERT INTO timetable_slots (
            section_id, day_of_week, period, room_id, subject_code, staff_id, is_lab_block, run_id, is_pinned
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);
                for (const slot of solverResult.slots) {
                    insertSlotStmt.run(slot.section_id, slot.day_of_week, slot.period, slot.room_id, slot.subject_code, slot.staff_id, slot.is_lab_block || 0, runId);
                }
                // Update engine state
                db.prepare(`
          UPDATE engine_state SET
            solve_status = 'completed',
            calendar_status = 'not_run',
            stale = 0,
            solve_error = NULL,
            last_solve_at = ?
          WHERE id = 1
        `).run(now);
            }
            else {
                db.prepare(`
          UPDATE engine_state SET
            solve_status = 'failed',
            solve_error = ?,
            last_solve_at = ?
          WHERE id = 1
        `).run(solverResult.diagnosis || 'Solver reported infeasible', now);
            }
            db.exec('COMMIT;');
            const summary = {
                id: runId,
                status: solverResult.status,
                objective: solverResult.objective,
                wall_time: solverResult.wall_time,
                created_at: now,
                clash_count: totalClashes,
                wasted_seats: solverResult.wasted_seats || 0,
                diagnosis: solverResult.diagnosis,
                message: solverResult.message,
                slots_count: solverResult.slots?.length || 0,
            };
            solverLatestResult = summary;
            solverProgress = 100;
            return summary;
        }
        catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    }
    catch (err) {
        solverError = err.message;
        throw err;
    }
    finally {
        solverRunning = false;
    }
}
/**
 * Returns timetable slots with optional filters.
 */
export function getTimetableSlots(filters = {}) {
    let query = `
    SELECT
      t.slot_id,
      t.section_id,
      s.section_label,
      t.subject_code,
      sub.subject_name,
      t.staff_id,
      stf.staff_name,
      t.room_id,
      r.room_name,
      t.day_of_week,
      t.period,
      t.is_lab_block,
      t.run_id,
      t.is_pinned
    FROM timetable_slots t
    LEFT JOIN sections s ON t.section_id = s.section_id
    LEFT JOIN subjects sub ON t.subject_code = sub.subject_code
    LEFT JOIN staff stf ON t.staff_id = stf.staff_id
    LEFT JOIN rooms r ON t.room_id = r.room_id
    WHERE 1=1
  `;
    const params = [];
    if (filters.section_id) {
        query += ` AND t.section_id = ?`;
        params.push(filters.section_id);
    }
    if (filters.staff_id) {
        query += ` AND t.staff_id = ?`;
        params.push(filters.staff_id);
    }
    if (filters.room_id) {
        query += ` AND t.room_id = ?`;
        params.push(filters.room_id);
    }
    if (filters.day_of_week) {
        query += ` AND t.day_of_week = ?`;
        params.push(filters.day_of_week);
    }
    query += ` ORDER BY t.day_of_week ASC, t.period ASC, t.room_id ASC`;
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((r) => ({
        slot_id: r.slot_id,
        section_id: r.section_id,
        subject_code: r.subject_code,
        subject_name: r.subject_name || r.subject_code,
        staff_id: r.staff_id,
        staff_name: r.staff_name || r.staff_id,
        room_id: r.room_id,
        room_name: r.room_name || r.room_id,
        day_of_week: r.day_of_week,
        period: r.period,
        is_lab_block: r.is_lab_block,
        run_id: r.run_id,
        is_pinned: r.is_pinned,
    }));
}
/**
 * Returns latest solver run metadata.
 */
export function getLatestSolverRun() {
    const stmt = db.prepare(`
    SELECT * FROM solver_runs ORDER BY id DESC LIMIT 1
  `);
    const row = stmt.get();
    if (!row)
        return null;
    const countStmt = db.prepare(`SELECT count(*) as c FROM timetable_slots WHERE run_id = ?`);
    const cRow = countStmt.get(row.id);
    return {
        id: row.id,
        status: row.status,
        objective: row.objective,
        wall_time: row.wall_time,
        created_at: row.created_at,
        clash_count: row.clash_count || 0,
        wasted_seats: row.wasted_seats || 0,
        diagnosis: row.diagnosis,
        message: row.diagnosis ? row.diagnosis : `Generated timetable (${row.status}) with ${row.clash_count || 0} clashes.`,
        slots_count: cRow?.c || 0,
    };
}
