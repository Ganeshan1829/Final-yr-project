import { registerRule } from '../registry.js';
export function registerRulesRules() {
    registerRule({
        code: 'RUL-001',
        dataset: 'rules',
        severity: 'error',
        description: 'Number of period_N keys must equal periods_per_day',
        run: (ctx) => {
            let periodCount = ctx.rules.periods?.length || 0;
            if (ctx.rawRulesRows && ctx.rawRulesRows.length > 0) {
                const pKeys = ctx.rawRulesRows.filter((r) => /^period_\d+$/i.test(r.key.trim()));
                if (pKeys.length > 0) {
                    periodCount = pKeys.length;
                }
            }
            if (periodCount !== ctx.rules.periods_per_day) {
                ctx.addIssue({
                    rule_code: 'RUL-001',
                    dataset: 'rules',
                    row_number: 0,
                    column: 'periods_per_day',
                    severity: 'error',
                    action_taken: null,
                    original_value: String(periodCount),
                    new_value: String(ctx.rules.periods_per_day),
                    message: `Number of period keys (${periodCount}) must equal periods_per_day (${ctx.rules.periods_per_day})`,
                });
            }
        },
    });
    registerRule({
        code: 'RUL-003',
        dataset: 'rules',
        severity: 'error',
        description: 'min_section_size <= default_section_size <= max_section_size',
        run: (ctx) => {
            const { min_section_size, default_section_size, max_section_size } = ctx.rules;
            if (!(min_section_size <= default_section_size && default_section_size <= max_section_size)) {
                ctx.addIssue({
                    rule_code: 'RUL-003',
                    dataset: 'rules',
                    row_number: 0,
                    column: 'default_section_size',
                    severity: 'error',
                    action_taken: null,
                    original_value: `min=${min_section_size}, def=${default_section_size}, max=${max_section_size}`,
                    new_value: null,
                    message: `Section size constraint violated: min (${min_section_size}) <= default (${default_section_size}) <= max (${max_section_size})`,
                });
            }
        },
    });
    registerRule({
        code: 'RUL-004',
        dataset: 'rules',
        severity: 'error',
        description: 'semester_end after semester_start',
        run: (ctx) => {
            const { semester_start, semester_end } = ctx.rules;
            if (!semester_start || !semester_end || semester_end <= semester_start) {
                ctx.addIssue({
                    rule_code: 'RUL-004',
                    dataset: 'rules',
                    row_number: 0,
                    column: 'semester_end',
                    severity: 'error',
                    action_taken: null,
                    original_value: semester_end,
                    new_value: null,
                    message: `semester_end (${semester_end}) must be strictly after semester_start (${semester_start})`,
                });
            }
        },
    });
    registerRule({
        code: 'RUL-005',
        dataset: 'rules',
        severity: 'warning',
        description: 'semester_start is not a Monday',
        run: (ctx) => {
            const { semester_start } = ctx.rules;
            if (semester_start) {
                const d = new Date(semester_start + 'T00:00:00Z');
                if (!isNaN(d.getTime()) && d.getUTCDay() !== 1) {
                    ctx.addIssue({
                        rule_code: 'RUL-005',
                        dataset: 'rules',
                        row_number: 0,
                        column: 'semester_start',
                        severity: 'warning',
                        action_taken: null,
                        original_value: semester_start,
                        new_value: null,
                        message: `semester_start (${semester_start}) is not a Monday (falls on day ${d.getUTCDay()})`,
                    });
                }
            }
        },
    });
}
