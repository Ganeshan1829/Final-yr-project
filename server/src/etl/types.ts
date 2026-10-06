import { RulesData } from '../schemas/rules.js';

export type Severity = 'error' | 'warning';
export type ActionTaken = 'fixed' | 'filled' | 'removed' | 'dropped' | null;

export interface EtlIssue {
  rule_code: string;
  dataset: string;
  row_number: number;
  column: string | null;
  severity: Severity;
  action_taken: ActionTaken;
  original_value: string | null;
  new_value: string | null;
  message: string;
}

export interface RuleDefinition {
  code: string;
  dataset: string;
  severity: Severity;
  description: string;
  run: (ctx: EtlContext) => void;
}

export interface RawDatasetRow {
  row_number: number; // 1-based row index in uploaded file
  raw: Record<string, any>;
  data: Record<string, any>; // working copy modified by auto-fixes
  quarantined?: boolean;
  quarantineReason?: string;
}

export interface EtlContext {
  rules: RulesData;
  rawRulesRows?: Array<{ key: string; value: string }>;
  datasets: {
    subjects: RawDatasetRow[];
    rooms: RawDatasetRow[];
    staff: RawDatasetRow[];
    holidays: RawDatasetRow[];
    students_choices: RawDatasetRow[];
  };
  issues: EtlIssue[];
  addIssue: (issue: EtlIssue) => void;
  // Working structures
  cleaned: {
    subjects: any[];
    rooms: any[];
    staff: any[];
    staff_subjects: Array<{ staff_id: string; subject_code: string }>;
    holidays: any[];
    students: any[];
    student_choices: any[];
  };
}

export interface EtlRunSummary {
  rowsIn: number;
  rowsOut: number;
  duplicatesRemoved: number;
  autoFixes: number;
  warnings: number;
  errors: number;
  byRule: Record<string, number>;
  byDataset: Record<
    string,
    {
      rowsIn: number;
      rowsOut: number;
      errors: number;
      warnings: number;
    }
  >;
}
