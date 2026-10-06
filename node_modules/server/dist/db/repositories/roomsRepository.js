import { db } from '../../db.js';
export function getRooms(options) {
    if (options?.activeOnly) {
        const stmt = db.prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY room_id ASC");
        return stmt.all();
    }
    const stmt = db.prepare('SELECT * FROM rooms ORDER BY room_id ASC');
    return stmt.all();
}
export function getRoom(id) {
    const stmt = db.prepare('SELECT * FROM rooms WHERE room_id = ?');
    const row = stmt.get(id);
    return row || null;
}
