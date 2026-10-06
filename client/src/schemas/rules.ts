import { z } from 'zod';

export const PeriodSchema = z.object({
  period: z.number().int().min(1).max(10),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be in HH:MM format'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be in HH:MM format'),
});

export type Period = z.infer<typeof PeriodSchema>;

export const RulesFormSchema = z
  .object({
    semester_name: z.string().min(1, 'Semester name is required'),
    academic_year: z.string().min(1, 'Academic year is required'),
    department: z.string().min(1, 'Department is required'),
    semester_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
    semester_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
    working_days: z.array(z.string()).min(1, 'At least one working day must be selected'),
    saturday_makeup_allowed: z.boolean().default(false),
    periods_per_day: z.number().int().min(1).max(10),
    periods: z.array(PeriodSchema),
    teaching_weeks_planned: z.number().int().min(1, 'Must be at least 1 week'),
    default_section_size: z.number().int().min(1, 'Must be positive'),
    min_section_size: z.number().int().min(1, 'Must be positive'),
    max_section_size: z.number().int().min(1, 'Must be positive'),
    max_consecutive_theory_periods: z.number().int().min(1, 'Must be at least 1'),
    max_staff_periods_per_day: z.number().int().min(1, 'Must be at least 1'),
    timezone: z.string().default('Asia/Kolkata'),
  })
  .superRefine((data, ctx) => {
    if (data.semester_start && data.semester_end) {
      const start = new Date(data.semester_start);
      const end = new Date(data.semester_end);
      if (end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Semester end date must be strictly after start date',
          path: ['semester_end'],
        });
      }
    }

    if (data.min_section_size > data.default_section_size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum section size cannot exceed default section size',
        path: ['min_section_size'],
      });
    }
    if (data.default_section_size > data.max_section_size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Default section size cannot exceed maximum section size',
        path: ['default_section_size'],
      });
    }

    if (data.periods.length !== data.periods_per_day) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected ${data.periods_per_day} period slots, but received ${data.periods.length}`,
        path: ['periods'],
      });
    }

    const timeToMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const sortedPeriods = [...data.periods].sort((a, b) => a.period - b.period);
    for (let i = 0; i < sortedPeriods.length; i++) {
      const current = sortedPeriods[i];
      const startMins = timeToMinutes(current.start);
      const endMins = timeToMinutes(current.end);

      if (endMins <= startMins) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Period ${current.period} end time (${current.end}) must be after start time (${current.start})`,
          path: ['periods', i, 'end'],
        });
      }

      if (i > 0) {
        const prev = sortedPeriods[i - 1];
        const prevEndMins = timeToMinutes(prev.end);
        if (startMins < prevEndMins) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Period ${current.period} (${current.start}) overlaps with Period ${prev.period} (${prev.end})`,
            path: ['periods', i, 'start'],
          });
        }
      }
    }
  });

export type RulesData = z.infer<typeof RulesFormSchema>;

export function isMonday(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay() === 1;
}

export function computeCalendarWeeks(startDateStr: string, endDateStr: string): number {
  if (!startDateStr || !endDateStr) return 0;
  const start = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return 0;
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(days / 7);
}
