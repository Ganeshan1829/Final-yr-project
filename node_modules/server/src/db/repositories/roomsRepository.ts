import { db } from '../../db.js';

export interface RoomRecord {
  room_id: string;
  room_name: string;
  building: string | null;
  floor: number | null;
  capacity: number;
  room_type: 'classroom' | 'computer_lab' | 'seminar_hall' | 'auditorium';
  has_projector: number;
  is_ac: number;
  status: 'active' | 'maintenance';
}

export function getRooms(options?: { activeOnly?: boolean }): RoomRecord[] {
  if (options?.activeOnly) {
    const stmt = db.prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY room_id ASC");
    return stmt.all() as unknown as RoomRecord[];
  }
  const stmt = db.prepare('SELECT * FROM rooms ORDER BY room_id ASC');
  return stmt.all() as unknown as RoomRecord[];
}

export function getRoom(id: string): RoomRecord | null {
  const stmt = db.prepare('SELECT * FROM rooms WHERE room_id = ?');
  const row = stmt.get(id);
  return (row as unknown as RoomRecord) || null;
}
