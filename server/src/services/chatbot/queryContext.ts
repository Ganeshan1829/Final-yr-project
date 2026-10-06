/**
 * Deterministic helpers that make the live LLM reliable: relative dates ("next week", "tomorrow")
 * and staff names ("Prof Karthik") are resolved in code, then handed to the model as facts.
 */

export interface StaffRow {
  staff_id: string;
  staff_name: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TITLES = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'mam', 'teacher', 'staff', 'faculty']);

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return r;
}

/** Monday of the week containing d (weeks run Monday to Sunday). */
function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return addDays(d, -offset);
}

/** Lookup table the model uses to convert relative expressions into YYYY-MM-DD. */
export function buildDateTable(now: Date = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMon = mondayOf(today);
  const nextMon = addDays(thisMon, 7);
  const lastMon = addDays(thisMon, -7);
  const lines = [
    `today = ${iso(today)} (${DAY_NAMES[today.getDay()]})`,
    `tomorrow = ${iso(addDays(today, 1))}`,
    `day after tomorrow = ${iso(addDays(today, 2))}`,
    `yesterday = ${iso(addDays(today, -1))}`,
    `this week = ${iso(thisMon)} to ${iso(addDays(thisMon, 4))} (Mon-Fri), weekend ends ${iso(addDays(thisMon, 6))}`,
    `next week = ${iso(nextMon)} to ${iso(addDays(nextMon, 4))} (Mon-Fri), weekend ends ${iso(addDays(nextMon, 6))}`,
    `last week = ${iso(lastMon)} to ${iso(addDays(lastMon, 4))} (Mon-Fri)`,
  ];
  // next occurrence of each weekday strictly after today ("next Tuesday", "on Friday")
  const upcoming = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const delta = ((dow - today.getDay() + 7) % 7) || 7;
    return `${DAY_NAMES[dow]} = ${iso(addDays(today, delta))}`;
  });
  lines.push(`upcoming weekdays: ${upcoming.join(', ')}`);
  return lines.join('\n');
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TITLES.has(t));
}

/** Staff whose name shares a whole word with the text. Several results means the name is ambiguous. */
export function findStaffByName(text: string, staff: StaffRow[]): StaffRow[] {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !TITLES.has(t))
  );
  if (words.size === 0) return [];
  const scored = staff
    .map((s) => ({ s, hits: nameTokens(s.staff_name).filter((t) => words.has(t)).length }))
    .filter((x) => x.hits > 0);
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((x) => x.hits));
  return scored.filter((x) => x.hits === best).map((x) => x.s);
}

/** Facts for the model: staff mentioned in the user's message, mapped to IDs. */
export function buildStaffHint(message: string, staff: StaffRow[]): string {
  const explicit = new Set((message.match(/\bSTF\d+\b/gi) || []).map((x) => x.toUpperCase()));
  const matches = findStaffByName(message, staff).filter((s) => !explicit.has(s.staff_id.toUpperCase()));
  if (matches.length === 0) return '';
  if (matches.length === 1) {
    return `Resolved staff in the user's message: ${matches[0].staff_name} = ${matches[0].staff_id}. Use this ID.`;
  }
  return `The user's staff name matches several people: ${matches.map((m) => `${m.staff_name} = ${m.staff_id}`).join('; ')}. Ask which one they mean.`;
}

const STAFF_ID_RE = /^STF\d+$/i;

/** If the model put a staff NAME where an ID belongs, swap in the real ID when the name is unambiguous. */
export function normalizeStaffArgs<T>(args: T, staff: StaffRow[]): T {
  const fix = (value: unknown): unknown => {
    if (typeof value !== 'string' || STAFF_ID_RE.test(value.trim())) return typeof value === 'string' ? value.trim().toUpperCase() : value;
    const matches = findStaffByName(value, staff);
    return matches.length === 1 ? matches[0].staff_id : value;
  };
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(node)) {
        if (/staff_id$/i.test(k)) out[k] = fix(v);
        else if (/staff_ids$/i.test(k) && Array.isArray(v)) out[k] = v.map(fix);
        else out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(args);
}

/** Drop section filters the model invented (e.g. "CS301-A" when sections are CS301-S1..S4) so they cannot hide real rows. */
export function dropUnknownSections<T>(args: T, sectionLabels: string[]): T {
  if (!args || typeof args !== 'object' || sectionLabels.length === 0) return args;
  const known = new Set(sectionLabels.map((l) => l.toUpperCase()));
  const out: any = { ...(args as any) };
  const isKnown = (v: unknown) => typeof v === 'string' && (known.has(v.toUpperCase()) || /^\d+$/.test(v));
  if ('section_id' in out && out.section_id !== undefined && !isKnown(out.section_id)) delete out.section_id;
  return out;
}
