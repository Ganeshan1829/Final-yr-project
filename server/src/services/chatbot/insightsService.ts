import { db } from '../../db.js';

export interface InsightsResult {
  underused_rooms: Array<{
    room_id: string;
    room_name: string;
    capacity: number;
    room_type: string;
    booked_periods: number;
    utilization_pct: number;
  }>;
  wasted_seat_allocations: Array<{
    room_id: string;
    room_capacity: number;
    section_id: string;
    subject_code: string;
    section_size: number;
    wasted_seats: number;
  }>;
  overloaded_or_gap_staff: Array<{
    staff_id: string;
    staff_name: string;
    weekly_hours: number;
    issue: string;
  }>;
  shortfall_risks: Array<{
    subject_code: string;
    subject_name: string;
    section_label: string;
    required_hours: number;
    delivered_hours: number;
    shortfall_hours: number;
  }>;
}

/**
 * Deterministically computes timetable insights:
 * - Underutilized rooms (utilization < threshold)
 * - Wasted seats (rooms with capacity much greater than section size)
 * - Staff overloaded or with large gaps
 * - Shortfall risks from hours_summary
 */
export function computeTimetableInsights(options?: {
  utilizationThresholdPct?: number;
  wastedSeatsMin?: number;
}): InsightsResult {
  const threshold = options?.utilizationThresholdPct ?? 40;
  const wastedMin = options?.wastedSeatsMin ?? 15;

  // 1. Room utilization
  const totalSlotsCount = (db.prepare('SELECT COUNT(DISTINCT date || "-" || period) as total FROM calendar_sessions').get() as any)?.total || 1;
  const rooms = db.prepare('SELECT room_id as id, room_name as name, capacity, room_type as type FROM rooms').all() as any[];
  
  const roomUsage = db.prepare(`
    SELECT room_id, COUNT(*) as booked
    FROM calendar_sessions
    WHERE session_type = 'regular'
    GROUP BY room_id
  `).all() as any[];
  const roomUsageMap = new Map(roomUsage.map((u) => [u.room_id, u.booked]));

  const underused_rooms: InsightsResult['underused_rooms'] = [];
  for (const r of rooms) {
    const booked = roomUsageMap.get(r.id) || 0;
    const pct = Math.round((booked / totalSlotsCount) * 100);
    if (pct < threshold) {
      underused_rooms.push({
        room_id: r.id,
        room_name: r.name,
        capacity: r.capacity,
        room_type: r.type,
        booked_periods: booked,
        utilization_pct: pct,
      });
    }
  }

  // 2. Wasted seats in timetable slots
  const wastedRows = db.prepare(`
    SELECT 
      ts.room_id,
      r.capacity as room_capacity,
      ts.section_id,
      ts.subject_code,
      sec.size as section_size,
      (r.capacity - sec.size) as wasted_seats
    FROM timetable_slots ts
    JOIN rooms r ON ts.room_id = r.room_id
    JOIN sections sec ON ts.section_id = sec.section_id
    WHERE (r.capacity - sec.size) >= ?
    GROUP BY ts.room_id, ts.section_id
    ORDER BY wasted_seats DESC
  `).all(wastedMin) as any[];

  const wasted_seat_allocations = wastedRows.map((row) => ({
    room_id: row.room_id,
    room_capacity: row.room_capacity,
    section_id: String(row.section_id),
    subject_code: row.subject_code,
    section_size: row.section_size,
    wasted_seats: row.wasted_seats,
  }));

  // 3. Staff workload & gaps
  const staffMembers = db.prepare('SELECT staff_id as id, staff_name as name, max_hours_per_week FROM staff').all() as any[];
  const staffLoad = db.prepare(`
    SELECT staff_id, COUNT(*) as weekly_hours
    FROM timetable_slots
    GROUP BY staff_id
  `).all() as any[];
  const staffLoadMap = new Map(staffLoad.map((s) => [s.staff_id, s.weekly_hours]));

  const overloaded_or_gap_staff: InsightsResult['overloaded_or_gap_staff'] = [];
  for (const s of staffMembers) {
    const hours = staffLoadMap.get(s.id) || 0;
    if (hours > (s.max_hours_per_week || 20)) {
      overloaded_or_gap_staff.push({
        staff_id: s.id,
        staff_name: s.name,
        weekly_hours: hours,
        issue: `Exceeds max weekly hours limit (${hours} > ${s.max_hours_per_week || 20})`,
      });
    }

    // Check for gaps on any day
    const staffDaySlots = db.prepare(`
      SELECT day_of_week, period
      FROM timetable_slots
      WHERE staff_id = ?
      ORDER BY day_of_week, period
    `).all(s.id) as Array<{ day_of_week: number; period: number }>;

    const byDay = new Map<number, number[]>();
    for (const slot of staffDaySlots) {
      if (!byDay.has(slot.day_of_week)) byDay.set(slot.day_of_week, []);
      byDay.get(slot.day_of_week)!.push(slot.period);
    }

    for (const [day, periods] of byDay.entries()) {
      for (let i = 0; i < periods.length - 1; i++) {
        const gap = periods[i + 1] - periods[i] - 1;
        if (gap >= 3) {
          overloaded_or_gap_staff.push({
            staff_id: s.id,
            staff_name: s.name,
            weekly_hours: hours,
            issue: `Large gap of ${gap} periods on Day ${day} between period ${periods[i]} and ${periods[i + 1]}`,
          });
          break;
        }
      }
    }
  }

  // 4. Shortfall risks
  const shortfallRows = db.prepare(`
    SELECT subject_code, subject_name, section_label, required_hours, delivered_hours, shortfall_hours
    FROM hours_summary
    WHERE shortfall_hours > 0
    ORDER BY shortfall_hours DESC
  `).all() as any[];

  const shortfall_risks = shortfallRows.map((r) => ({
    subject_code: r.subject_code,
    subject_name: r.subject_name,
    section_label: r.section_label,
    required_hours: r.required_hours,
    delivered_hours: r.delivered_hours,
    shortfall_hours: r.shortfall_hours,
  }));

  return {
    underused_rooms,
    wasted_seat_allocations,
    overloaded_or_gap_staff,
    shortfall_risks,
  };
}
