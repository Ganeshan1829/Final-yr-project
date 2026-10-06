import { RuleDefinition } from './types.js';

class RuleRegistry {
  private rules: Map<string, RuleDefinition> = new Map();

  register(rule: RuleDefinition): void {
    if (this.rules.has(rule.code)) {
      console.warn(`Rule with code ${rule.code} already registered. Overwriting.`);
    }
    this.rules.set(rule.code, rule);
  }

  get(code: string): RuleDefinition | undefined {
    return this.rules.get(code);
  }

  getAll(): RuleDefinition[] {
    return Array.from(this.rules.values());
  }

  getByDataset(dataset: string): RuleDefinition[] {
    return this.getAll().filter((r) => r.dataset === dataset);
  }
}

export const registry = new RuleRegistry();

export function registerRule(rule: RuleDefinition): void {
  registry.register(rule);
}

export function getAllRules(): RuleDefinition[] {
  return registry.getAll();
}

export function getRulesByDataset(dataset: string): RuleDefinition[] {
  return registry.getByDataset(dataset);
}
