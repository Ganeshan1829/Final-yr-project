import { z } from 'zod';
import { db } from '../db.js';
import { getStoredRules } from './rulesService.js';
export const EventInputSchema = z.object({
    event_id: z.string().min(1, 'event_id is required'),
    event_name: z.string().min(1, 'event_name is required'),
    event_type: z.string().min(1, 'event_type is required'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
    start_period: z.number().int().min(1, 'start_period must be >= 1'),
    end_period: z.number().int().min(1, 'end_period must be >= 1'),
    venue_room_id: z.string().min(1, 'venue_room_id is required'),
    staff_involved: z.union([z.array(z.string()), z.string()]).transform((val) => {
        if (Array.isArray(val))
            return val;
        return val
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean);
    }),
    student_scope: z.enum(['ALL', 'PARTIAL', 'NONE'], {
        errorMap: () => ({ message: 'student_scope must be ALL, PARTIAL, or NONE' }),
    }),
    expected_attendance: z.number().int().nonnegative('expected_attendance must be >= 0'),
});
/**
 * Validates event rules:
 * - date inside semester
 * - periods inside periods_per_day (and start <= end)
 * - venue must exist in uploaded rooms
 * - staff must exist in uploaded staff
 */
export function validateEvent(data) {
    // 1. Period checks
    if (data.start_period > data.end_period) {
        return { valid: false, error: `start_period (${data.start_period}) cannot be greater than end_period (${data.end_period})` };
    }
    // 2. Semester & periods_per_day checks from Rules
    const { rules } = getStoredRules();
    if (!rules || !rules.semester_start || !rules.semester_end) {
        return { valid: false, error: 'Cannot validate event: semester rules have not been saved yet' };
    }
    if (data.date < rules.semester_start || data.date > rules.semester_end) {
        return {
            valid: false,
            error: `Event date (${data.date}) falls outside active semester dates (${rules.semester_start} to ${rules.semester_end})`,
        };
    }
    const maxPeriods = rules.periods_per_day || 7;
    if (data.end_period > maxPeriods) {
        return {
            valid: false,
            error: `end_period (${data.end_period}) exceeds the configured periods_per_day (${maxPeriods})`,
        };
    }
    // 3. Venue check: venue_room_id must exist in uploaded rooms
    const roomsUploadStmt = db.prepare("SELECT id FROM uploads WHERE dataset = 'rooms'");
    const roomsUpload = roomsUploadStmt.get();
    if (!roomsUpload) {
        return { valid: false, error: 'Cannot schedule event: "rooms" dataset has not been uploaded yet' };
    }
    const roomRowsStmt = db.prepare('SELECT row_json FROM dataset_rows WHERE upload_id = ?');
    const roomRows = roomRowsStmt.all(roomsUpload.id);
    const existingRoomIds = new Set();
    roomRows.forEach((r) => {
        try {
            const parsed = JSON.parse(r.row_json);
            const id = parsed.room_id || parsed.ROOM_ID || parsed['Room ID'];
            if (id)
                existingRoomIds.add(String(id).trim().toUpperCase());
        }
        catch { }
    });
    if (!existingRoomIds.has(data.venue_room_id.trim().toUpperCase())) {
        return {
            valid: false,
            error: `Unknown venue_room_id: "${data.venue_room_id}". Venue must match an existing room in the uploaded rooms dataset.`,
        };
    }
    // 4. Staff check: each staff_involved must exist in uploaded staff
    if (data.staff_involved && data.staff_involved.length > 0) {
        const staffUploadStmt = db.prepare("SELECT id FROM uploads WHERE dataset = 'staff'");
        const staffUpload = staffUploadStmt.get();
        if (!staffUpload) {
            return { valid: false, error: 'Cannot validate staff: "staff" dataset has not been uploaded yet' };
        }
        const staffRowsStmt = db.prepare('SELECT row_json FROM dataset_rows WHERE upload_id = ?');
        const staffRows = staffRowsStmt.all(staffUpload.id);
        const existingStaffIds = new Set();
        staffRows.forEach((r) => {
            try {
                const parsed = JSON.parse(r.row_json);
                const id = parsed.staff_id || parsed.STAFF_ID || parsed['Staff ID'];
                if (id)
                    existingStaffIds.add(String(id).trim().toUpperCase());
            }
            catch { }
        });
        for (const staffId of data.staff_involved) {
            if (!existingStaffIds.has(staffId.trim().toUpperCase())) {
                return {
                    valid: false,
                    error: `Staff member "${staffId}" does not exist in the uploaded staff dataset.`,
                };
            }
        }
    }
    return { valid: true };
}
export function createEvent(data) {
    const parsed = EventInputSchema.parse(data);
    const validation = validateEvent(parsed);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    const now = new Date().toISOString();
    const staffJson = JSON.stringify(parsed.staff_involved);
    const stmt = db.prepare(`
    INSERT INTO events (event_id, event_name, event_type, date, start_period, end_period, venue_room_id, staff_involved, student_scope, expected_attendance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const result = stmt.run(parsed.event_id, parsed.event_name, parsed.event_type, parsed.date, parsed.start_period, parsed.end_period, parsed.venue_room_id, staffJson, parsed.student_scope, parsed.expected_attendance, now);
    return {
        id: Number(result.lastInsertRowid),
        ...parsed,
        created_at: now,
    };
}
export function listEvents() {
    const stmt = db.prepare('SELECT * FROM events ORDER BY date ASC, start_period ASC');
    const rows = stmt.all();
    return rows.map((r) => {
        let staff = [];
        try {
            staff = JSON.parse(r.staff_involved);
        }
        catch {
            staff = [];
        }
        return {
            id: r.id,
            event_id: r.event_id,
            event_name: r.event_name,
            event_type: r.event_type,
            date: r.date,
            start_period: r.start_period,
            end_period: r.end_period,
            venue_room_id: r.venue_room_id,
            staff_involved: staff,
            student_scope: r.student_scope,
            expected_attendance: r.expected_attendance,
            created_at: r.created_at,
        };
    });
}
export function getEvent(id) {
    const stmt = db.prepare('SELECT * FROM events WHERE event_id = ? OR id = ?');
    const r = stmt.get(id, id);
    if (!r)
        return null;
    let staff = [];
    try {
        staff = JSON.parse(r.staff_involved);
    }
    catch {
        staff = [];
    }
    return {
        id: r.id,
        event_id: r.event_id,
        event_name: r.event_name,
        event_type: r.event_type,
        date: r.date,
        start_period: r.start_period,
        end_period: r.end_period,
        venue_room_id: r.venue_room_id,
        staff_involved: staff,
        student_scope: r.student_scope,
        expected_attendance: r.expected_attendance,
        created_at: r.created_at,
    };
}
export function deleteEvent(id) {
    const stmt = db.prepare('DELETE FROM events WHERE event_id = ? OR id = ?');
    const result = stmt.run(id, id);
    return result.changes > 0;
}
