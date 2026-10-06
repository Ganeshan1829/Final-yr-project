import { db } from '../../db.js';
export function getHolidaysClean(options) {
    if (options?.activeOnly) {
        const stmt = db.prepare('SELECT * FROM holidays_clean WHERE ignored = 0 ORDER BY date_from ASC');
        return stmt.all();
    }
    const stmt = db.prepare('SELECT * FROM holidays_clean ORDER BY date_from ASC');
    return stmt.all();
}
