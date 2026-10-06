import Papa from 'papaparse';
import { db } from '../db.js';
import { markRunsStale } from '../db/repositories/etlRepository.js';
import { RulesFormSchema, rulesToCsvRows, csvRowsToRules, } from '../schemas/rules.js';
export function getStoredRules() {
    const stmt = db.prepare('SELECT rules_json, updated_at FROM rules WHERE id = 1');
    const row = stmt.get();
    if (!row) {
        return { rules: null, updatedAt: null };
    }
    try {
        const parsed = JSON.parse(row.rules_json);
        return { rules: parsed, updatedAt: row.updated_at };
    }
    catch {
        return { rules: null, updatedAt: null };
    }
}
export function saveRules(data) {
    const validated = RulesFormSchema.parse(data);
    const now = new Date().toISOString();
    const stmt = db.prepare(`
    INSERT INTO rules (id, rules_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      rules_json = excluded.rules_json,
      updated_at = excluded.updated_at
  `);
    stmt.run(JSON.stringify(validated), now);
    markRunsStale();
    return validated;
}
export function importRulesCsv(csvBuffer) {
    const text = csvBuffer.toString('utf-8');
    const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim().toLowerCase(),
    });
    const rawRows = [];
    parsed.data.forEach((row) => {
        if (row.key !== undefined && row.key !== null) {
            rawRows.push({
                key: String(row.key),
                value: row.value !== undefined ? String(row.value) : '',
                description: row.description !== undefined ? String(row.description) : '',
            });
        }
    });
    if (rawRows.length === 0) {
        throw new Error('Rules CSV file is empty or does not contain required headers: key, value, description');
    }
    const rulesData = csvRowsToRules(rawRows);
    return saveRules(rulesData);
}
export function exportRulesCsv() {
    const { rules } = getStoredRules();
    if (!rules) {
        throw new Error('No rules have been saved yet to export');
    }
    const rows = rulesToCsvRows(rules);
    return Papa.unparse(rows, {
        quotes: true,
        header: true,
    });
}
