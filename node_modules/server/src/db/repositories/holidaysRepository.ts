import { db } from '../../db.js';

export interface HolidayCleanRecord {
  holiday_id: string;
  name: string;
  date_from: string;
  date_to: string;
  type: string;
  applies_to: string | null;
  ignored: number;
}

export function getHolidaysClean(options?: { activeOnly?: boolean }): HolidayCleanRecord[] {
  if (options?.activeOnly) {
    const stmt = db.prepare('SELECT * FROM holidays_clean WHERE ignored = 0 ORDER BY date_from ASC');
    return stmt.all() as unknown as HolidayCleanRecord[];
  }
  const stmt = db.prepare('SELECT * FROM holidays_clean ORDER BY date_from ASC');
  return stmt.all() as unknown as HolidayCleanRecord[];
}
