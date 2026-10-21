import type { HabitCheckInRecord } from "./habit-check-ins";
import type { HabitRuleRecord } from "./habit-rules";
import { previousSleepHabitDate } from "./sleep-habit-rules";
import { updateWorkspaceRecord } from "./protocol";

type Change = { id: string; from: string; to: string };
/** Only unedited automatic bedtime results have unambiguous legacy date provenance. */
function legacyTarget(record: HabitCheckInRecord) {
  const data = record.data;
  const time = data.value_json.observed_local_time;
  return record.deleted_at === null && data.entry_method === "automatic" && data.evidence_type === "health_sleep_session"
    && data.value_json.rule_type === "sleep_start_before" && data.value_json.session_type === "main_sleep"
    && data.value_json.bedtime_date_version !== 2 && typeof time === "string" && /^(0[0-8]):[0-5]\d$/.test(time)
    ? previousSleepHabitDate(data.local_date) : null;
}

export function planSleepHabitDateCorrections(records: HabitCheckInRecord[], rules: HabitRuleRecord[]) {
  const changes: Change[] = [];
  const blocked: Array<{ id: string; reason: string }> = [];
  const occupied = new Map<string, Set<string>>();
  const key = (habit: string, date: string) => `${habit}:${date}`;
  for (const record of records.filter(record => record.deleted_at === null)) {
    const k = key(record.data.habit_id, record.data.local_date);
    if (!occupied.has(k)) occupied.set(k, new Set());
    occupied.get(k)!.add(record.id);
  }
  // Move oldest dates first, freeing each source day before moving the following night.
  for (const record of [...records].sort((a, b) => a.data.local_date.localeCompare(b.data.local_date) || a.id.localeCompare(b.id))) {
    const to = legacyTarget(record);
    if (!to) continue;
    const rule = rules.find(rule => rule.id === record.data.rule_id && rule.data.habit_id === record.data.habit_id);
    if (!rule || to < rule.data.active_from || (rule.data.active_to !== null && to > rule.data.active_to)) {
      blocked.push({ id: record.id, reason: "归属日期不在原规则的生效范围内" }); continue;
    }
    if (occupied.get(key(record.data.habit_id, to))?.size) {
      blocked.push({ id: record.id, reason: "目标日期已有打卡，保留现有记录" }); continue;
    }
    changes.push({ id: record.id, from: record.data.local_date, to });
    occupied.get(key(record.data.habit_id, record.data.local_date))?.delete(record.id);
    occupied.set(key(record.data.habit_id, to), new Set([record.id]));
  }
  return { changes, blocked };
}

export function correctLegacySleepHabitDate(record: HabitCheckInRecord, timestamp: string) {
  const target = legacyTarget(record);
  if (!target) throw new Error("NOT_A_LEGACY_BEDTIME_CHECK_IN");
  return updateWorkspaceRecord(record, { ...record.data, local_date: target,
    value_json: { ...record.data.value_json, bedtime_date_version: 2, observed_local_date: record.data.local_date } }, timestamp);
}
