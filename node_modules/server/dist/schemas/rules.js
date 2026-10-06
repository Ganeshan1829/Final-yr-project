import { z } from 'zod';
export const PeriodSchema = z.object({
    period: z.number().int().min(1).max(10),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be in HH:MM format'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be in HH:MM format'),
});
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
    // 1. Date comparison: end must be after start
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
    // 2. Section sizes: min <= default <= max
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
    // 3. Periods validation: length matches periods_per_day
    if (data.periods.length !== data.periods_per_day) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Expected ${data.periods_per_day} period slots, but received ${data.periods.length}`,
            path: ['periods'],
        });
    }
    // Check each period start < end, and no overlaps
    const timeToMinutes = (t) => {
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
export function isMonday(dateStr) {
    if (!dateStr)
        return false;
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 1;
}
export function computeCalendarWeeks(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr)
        return 0;
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0)
        return 0;
    const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return Math.ceil(days / 7);
}
/**
 * Converts rules data object to flat key-value-description array for CSV export
 */
export function rulesToCsvRows(rules) {
    const rows = [
        { key: 'semester_name', value: rules.semester_name, description: 'Academic semester label' },
        { key: 'academic_year', value: rules.academic_year, description: 'Academic year (e.g. 2024-2025)' },
        { key: 'department', value: rules.department, description: 'Department code or name' },
        { key: 'semester_start', value: rules.semester_start, description: 'Semester starting date (YYYY-MM-DD)' },
        { key: 'semester_end', value: rules.semester_end, description: 'Semester ending date (YYYY-MM-DD)' },
        { key: 'working_days', value: rules.working_days.join(';'), description: 'Semicolon-separated list of working days' },
        { key: 'saturday_makeup_allowed', value: String(rules.saturday_makeup_allowed), description: 'Whether make-up classes can be scheduled on Saturdays' },
        { key: 'periods_per_day', value: String(rules.periods_per_day), description: 'Total instructional periods per day' },
    ];
    rules.periods.forEach((p) => {
        rows.push({
            key: `period_${p.period}`,
            value: `${p.start}-${p.end}`,
            description: `Timing for period slot ${p.period} (HH:MM-HH:MM)`,
        });
    });
    rows.push({ key: 'teaching_weeks_planned', value: String(rules.teaching_weeks_planned), description: 'Number of active teaching weeks planned' }, { key: 'default_section_size', value: String(rules.default_section_size), description: 'Standard student cohort size per section' }, { key: 'min_section_size', value: String(rules.min_section_size), description: 'Minimum allowed cohort size per section' }, { key: 'max_section_size', value: String(rules.max_section_size), description: 'Maximum cap on students per section' }, { key: 'max_consecutive_theory_periods', value: String(rules.max_consecutive_theory_periods), description: 'Max back-to-back theory periods allowed' }, { key: 'max_staff_periods_per_day', value: String(rules.max_staff_periods_per_day), description: 'Maximum teaching load per faculty member per day' }, { key: 'timezone', value: rules.timezone || 'Asia/Kolkata', description: 'Institution local timezone' });
    return rows;
}
/**
 * Parses flat key-value CSV rows back into structured RulesData
 */
export function csvRowsToRules(rows) {
    const map = new Map();
    rows.forEach((r) => {
        if (r.key)
            map.set(r.key.trim().toLowerCase(), (r.value || '').trim());
    });
    const periodsPerDay = Number(map.get('periods_per_day') || 7);
    const periods = [];
    for (let i = 1; i <= periodsPerDay; i++) {
        const val = map.get(`period_${i}`);
        if (val && val.includes('-')) {
            const [start, end] = val.split('-');
            periods.push({ period: i, start: start.trim(), end: end.trim() });
        }
        else {
            // Default period timing fallback
            const startH = 8 + i;
            const endH = startH + 1;
            periods.push({
                period: i,
                start: `${String(startH).padStart(2, '0')}:30`,
                end: `${String(endH).padStart(2, '0')}:30`,
            });
        }
    }
    const rawWorkingDays = map.get('working_days');
    const working_days = rawWorkingDays
        ? rawWorkingDays.split(';').map((s) => s.trim().toUpperCase()).filter(Boolean)
        : ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    const rawSat = map.get('saturday_makeup_allowed')?.toLowerCase();
    const saturday_makeup_allowed = rawSat === 'true' || rawSat === '1' || rawSat === 'yes';
    const rawRules = {
        semester_name: map.get('semester_name') || 'Fall 2026',
        academic_year: map.get('academic_year') || '2026-2027',
        department: map.get('department') || 'Computer Science & Engineering',
        semester_start: map.get('semester_start') || '2026-07-06',
        semester_end: map.get('semester_end') || '2026-11-20',
        working_days,
        saturday_makeup_allowed,
        periods_per_day: periodsPerDay,
        periods,
        teaching_weeks_planned: Number(map.get('teaching_weeks_planned') || 16),
        default_section_size: Number(map.get('default_section_size') || 60),
        min_section_size: Number(map.get('min_section_size') || 30),
        max_section_size: Number(map.get('max_section_size') || 70),
        max_consecutive_theory_periods: Number(map.get('max_consecutive_theory_periods') || 2),
        max_staff_periods_per_day: Number(map.get('max_staff_periods_per_day') || 4),
        timezone: map.get('timezone') || 'Asia/Kolkata',
    };
    return RulesFormSchema.parse(rawRules);
}
