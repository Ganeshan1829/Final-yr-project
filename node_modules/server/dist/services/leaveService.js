import { z } from 'zod';
import { db } from '../db.js';
import { getStoredRules } from './rulesService.js';
export const LeaveInputSchema = z
    .object({
    leave_id: z.string().min(1, 'leave_id is required'),
    staff_id: z.string().min(1, 'staff_id is required'),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_from must be in YYYY-MM-DD format'),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_to must be in YYYY-MM-DD format'),
    leave_type: z.enum(['casual', 'on_duty', 'conference', 'earned'], {
        errorMap: () => ({ message: 'leave_type must be casual, on_duty, conference, or earned' }),
    }),
    reason: z.string().default(''),
    status: z.enum(['pending', 'approved', 'rejected']).default('approved'),
})
    .superRefine((data, ctx) => {
    if (data.date_from && data.date_to) {
        if (data.date_to < data.date_from) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'date_to cannot be earlier than date_from',
                path: ['date_to'],
            });
        }
    }
});
/**
 * Validates leave requirements:
 * - staff exists in uploaded staff dataset
 * - dates inside semester
 */
export function validateLeave(data) {
    // 1. Semester dates check
    const { rules } = getStoredRules();
    if (!rules || !rules.semester_start || !rules.semester_end) {
        return { valid: false, error: 'Cannot validate leave: semester rules have not been saved yet' };
    }
    if (data.date_from < rules.semester_start || data.date_to > rules.semester_end) {
        return {
            valid: false,
            error: `Leave dates (${data.date_from} to ${data.date_to}) fall outside active semester dates (${rules.semester_start} to ${rules.semester_end})`,
        };
    }
    // 2. Staff existence check
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
    if (!existingStaffIds.has(data.staff_id.trim().toUpperCase())) {
        return {
            valid: false,
            error: `Staff member "${data.staff_id}" does not exist in the uploaded staff dataset.`,
        };
    }
    return { valid: true };
}
export function createLeave(data) {
    const parsed = LeaveInputSchema.parse(data);
    const validation = validateLeave(parsed);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    const now = new Date().toISOString();
    const stmt = db.prepare(`
    INSERT INTO leave (leave_id, staff_id, date_from, date_to, leave_type, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const result = stmt.run(parsed.leave_id, parsed.staff_id, parsed.date_from, parsed.date_to, parsed.leave_type, parsed.reason || '', parsed.status || 'approved', now);
    return {
        id: Number(result.lastInsertRowid),
        ...parsed,
        created_at: now,
    };
}
export function listLeave() {
    const stmt = db.prepare('SELECT * FROM leave ORDER BY date_from ASC');
    return stmt.all();
}
export function getLeave(id) {
    const stmt = db.prepare('SELECT * FROM leave WHERE leave_id = ? OR id = ?');
    const r = stmt.get(id, id);
    return r || null;
}
export function deleteLeave(id) {
    const stmt = db.prepare('DELETE FROM leave WHERE leave_id = ? OR id = ?');
    const result = stmt.run(id, id);
    return result.changes > 0;
}
