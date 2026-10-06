import { z } from 'zod';
import Papa from 'papaparse';
import { db } from '../db.js';
import { getStoredRules } from './rulesService.js';
import { markRunsStale } from '../db/repositories/etlRepository.js';

export const HolidayInputSchema = z
  .object({
    holiday_id: z.string().optional(),
    name: z.string().min(1, 'Holiday name is required'),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
    type: z.enum(['public_holiday', 'institution_holiday', 'internal_exam'], {
      errorMap: () => ({ message: 'Type must be public_holiday, institution_holiday, or internal_exam' }),
    }),
    applies_to: z.string().default('ALL'),
  })
  .superRefine((data, ctx) => {
    if (data.date_from && data.date_to) {
      if (data.date_to < data.date_from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Date To must be equal to or after Date From',
          path: ['date_to'],
        });
      }
    }
  });

export type HolidayInput = z.infer<typeof HolidayInputSchema>;

export interface HolidayRecord {
  id: number;
  holiday_id: string;
  name: string;
  date_from: string;
  date_to: string;
  type: 'public_holiday' | 'institution_holiday' | 'internal_exam';
  applies_to: string;
  created_at: string;
}

export function validateHolidayDatesAgainstSemester(dateFrom: string, dateTo: string) {
  const { rules } = getStoredRules();
  if (!rules || !rules.semester_start || !rules.semester_end) {
    // If rules are not saved yet, we don't block
    return { ok: true, rulesConfigured: false };
  }

  if (dateFrom < rules.semester_start || dateTo > rules.semester_end) {
    return {
      ok: false,
      rulesConfigured: true,
      error: `Holiday dates (${dateFrom} to ${dateTo}) must fall inside the active semester period (${rules.semester_start} to ${rules.semester_end}).`,
    };
  }

  return { ok: true, rulesConfigured: true };
}

export function listHolidays(): HolidayRecord[] {
  const stmt = db.prepare('SELECT * FROM holidays ORDER BY date_from ASC');
  return stmt.all() as any[];
}

export function createHoliday(data: unknown): HolidayRecord {
  const parsed = HolidayInputSchema.parse(data);
  const dateCheck = validateHolidayDatesAgainstSemester(parsed.date_from, parsed.date_to);
  if (!dateCheck.ok) {
    throw new Error(dateCheck.error);
  }

  const holidayId = parsed.holiday_id || `HOL_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO holidays (holiday_id, name, date_from, date_to, type, applies_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(holidayId, parsed.name, parsed.date_from, parsed.date_to, parsed.type, parsed.applies_to, now);
  markRunsStale();

  return {
    id: Number(result.lastInsertRowid),
    holiday_id: holidayId,
    name: parsed.name,
    date_from: parsed.date_from,
    date_to: parsed.date_to,
    type: parsed.type,
    applies_to: parsed.applies_to,
    created_at: now,
  };
}

export function updateHoliday(id: number, data: unknown): HolidayRecord {
  const parsed = HolidayInputSchema.parse(data);
  const dateCheck = validateHolidayDatesAgainstSemester(parsed.date_from, parsed.date_to);
  if (!dateCheck.ok) {
    throw new Error(dateCheck.error);
  }

  const existingStmt = db.prepare('SELECT * FROM holidays WHERE id = ?');
  const existing = existingStmt.get(id) as any;
  if (!existing) {
    throw new Error(`Holiday with id ${id} not found`);
  }

  const holidayId = parsed.holiday_id || existing.holiday_id;

  const stmt = db.prepare(`
    UPDATE holidays
    SET holiday_id = ?, name = ?, date_from = ?, date_to = ?, type = ?, applies_to = ?
    WHERE id = ?
  `);

  stmt.run(holidayId, parsed.name, parsed.date_from, parsed.date_to, parsed.type, parsed.applies_to, id);
  markRunsStale();

  return {
    id,
    holiday_id: holidayId,
    name: parsed.name,
    date_from: parsed.date_from,
    date_to: parsed.date_to,
    type: parsed.type,
    applies_to: parsed.applies_to,
    created_at: existing.created_at,
  };
}

export function deleteHoliday(id: number): boolean {
  const stmt = db.prepare('DELETE FROM holidays WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0) {
    markRunsStale();
    return true;
  }
  return false;
}

export function importHolidaysCsv(buffer: Buffer): HolidayRecord[] {
  const text = buffer.toString('utf-8');
  const parsed = Papa.parse<Record<string, any>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const imported: HolidayRecord[] = [];
  const errors: string[] = [];

  parsed.data.forEach((row, idx) => {
    try {
      const name = String(row.name || '').trim();
      const date_from = String(row.date_from || '').trim();
      const date_to = String(row.date_to || '').trim();
      const type = String(row.type || 'public_holiday').trim() as any;
      const applies_to = String(row.applies_to || 'ALL').trim();
      const holiday_id = String(row.holiday_id || `HOL_${Date.now()}_${idx}`).trim();

      if (!name || !date_from || !date_to) return;

      const record = createHoliday({
        holiday_id,
        name,
        date_from,
        date_to,
        type,
        applies_to,
      });
      imported.push(record);
    } catch (err: any) {
      errors.push(`Row ${idx + 1}: ${err.message}`);
    }
  });

  if (imported.length === 0 && errors.length > 0) {
    throw new Error(`Failed to import holidays: ${errors.slice(0, 3).join('; ')}`);
  }

  return imported;
}
