class RuleRegistry {
    rules = new Map();
    register(rule) {
        if (this.rules.has(rule.code)) {
            console.warn(`Rule with code ${rule.code} already registered. Overwriting.`);
        }
        this.rules.set(rule.code, rule);
    }
    get(code) {
        return this.rules.get(code);
    }
    getAll() {
        return Array.from(this.rules.values());
    }
    getByDataset(dataset) {
        return this.getAll().filter((r) => r.dataset === dataset);
    }
}
export const registry = new RuleRegistry();
export function registerRule(rule) {
    registry.register(rule);
}
export function getAllRules() {
    return registry.getAll();
}
export function getRulesByDataset(dataset) {
    return registry.getByDataset(dataset);
}
