import { parseRecord, type WorkspaceRecord } from "./protocol";

export const HABIT_RULE_VERSION = 1 as const;

export type HabitRuleData = {
  habit_rule_version: typeof HABIT_RULE_VERSION;
  habit_id: string;
  rule_type: string;
  rule_version: number;
  config_json: Record<string, unknown>;
  active_from: string;
  active_to: string | null;
  enabled: boolean;
};
export type HabitRuleRecord = WorkspaceRecord<HabitRuleData>;

export function createHabitRuleData(fields: Omit<HabitRuleData, "habit_rule_version">): HabitRuleData {
  return validateData({ habit_rule_version: HABIT_RULE_VERSION, ...normalize(fields) });
}

export function parseHabitRuleRecord(value: string): HabitRuleRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "habit_rule" || record.version !== 1 || record.deleted_at !== null || record.updated_at !== record.created_at) {
    throw new Error("INVALID_HABIT_RULE_RECORD");
  }
  try { validateData(record.data as HabitRuleData); }
  catch { throw new Error("INVALID_HABIT_RULE_RECORD"); }
  return record as HabitRuleRecord;
}

export function activeHabitRule(rules: HabitRuleRecord[], habitId: string, localDate: string) {
  assertStableId(habitId);
  if (!isDateOnly(localDate)) throw new Error("INVALID_HABIT_RULE_DATE");
  const matching = rules.filter((rule) => rule.data.habit_id === habitId
    && rule.data.enabled
    && rule.data.active_from <= localDate
    && (rule.data.active_to === null || rule.data.active_to >= localDate));
  matching.sort((left, right) => right.data.rule_version - left.data.rule_version || right.created_at.localeCompare(left.created_at));
  if (matching.length > 1 && matching[0]!.data.rule_version === matching[1]!.data.rule_version) throw new Error("HABIT_RULE_VERSION_CONFLICT");
  return matching[0] ?? null;
}

function normalize(fields: Omit<HabitRuleData, "habit_rule_version">): Omit<HabitRuleData, "habit_rule_version"> {
  return { ...fields, rule_type: fields.rule_type.trim().toLowerCase(), config_json: structuredClone(fields.config_json) };
}

function validateData(data: HabitRuleData) {
  if (Object.keys(data).sort().join(",") !== "active_from,active_to,config_json,enabled,habit_id,habit_rule_version,rule_type,rule_version"
    || data.habit_rule_version !== HABIT_RULE_VERSION
    || !isStableId(data.habit_id)
    || typeof data.rule_type !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(data.rule_type)
    || !Number.isSafeInteger(data.rule_version) || data.rule_version < 1
    || !isPlainJsonObject(data.config_json) || JSON.stringify(data.config_json).length > 50_000
    || !isDateOnly(data.active_from)
    || !(data.active_to === null || (isDateOnly(data.active_to) && data.active_to >= data.active_from))
    || typeof data.enabled !== "boolean") throw new Error("INVALID_HABIT_RULE_DETAILS");
  return data;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try { return JSON.parse(JSON.stringify(value)) !== null; } catch { return false; }
}
function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function assertStableId(value: string) { if (!isStableId(value)) throw new Error("INVALID_HABIT_ID"); }
function isStableId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value); }
