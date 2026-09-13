import type { HabitRuleRecord } from "./habit-rules";
import { createHabitRuleData } from "./habit-rules";
import type { SleepSessionRecord } from "./sleep-sessions";

export const SLEEP_HABIT_RULE_TYPES = ["sleep_start_before", "wake_before"] as const;
export type SleepHabitRuleType = typeof SLEEP_HABIT_RULE_TYPES[number];
export type SleepHabitRuleFields = {
  rule_type: SleepHabitRuleType;
  threshold_local_time: string;
};
export type SleepHabitEvaluation = {
  local_date: string;
  status: "completed" | "missed";
  observed_local_time: string;
  threshold_local_time: string;
  rule_type: SleepHabitRuleType;
  explanation: string;
  value_json: {
    duration_minutes: number;
    observed_local_time: string;
    rule_type: SleepHabitRuleType;
    session_type: "main_sleep";
    threshold_local_time: string;
  };
};

export function createSleepHabitRuleData(input: {
  habitId: string;
  timezone: string;
  activeFrom: string;
  fields: SleepHabitRuleFields;
}) {
  assertTime(input.fields.threshold_local_time);
  assertTimezone(input.timezone);
  return createHabitRuleData({
    habit_id: input.habitId,
    rule_type: input.fields.rule_type,
    rule_version: 1,
    config_json: { threshold_local_time: input.fields.threshold_local_time, timezone: input.timezone },
    active_from: input.activeFrom,
    active_to: null,
    enabled: true,
  });
}

export function evaluateSleepHabitRule(rule: HabitRuleRecord, session: SleepSessionRecord): SleepHabitEvaluation {
  if (!SLEEP_HABIT_RULE_TYPES.includes(rule.data.rule_type as SleepHabitRuleType)) throw new Error("UNSUPPORTED_SLEEP_HABIT_RULE");
  if (!rule.data.enabled || session.deleted_at !== null || session.data.confirmation_status !== "confirmed" || session.data.session_type !== "main_sleep") throw new Error("SLEEP_SESSION_NOT_ELIGIBLE");
  const ruleType = rule.data.rule_type as SleepHabitRuleType;
  const threshold = rule.data.config_json.threshold_local_time;
  const timezone = rule.data.config_json.timezone;
  if (typeof threshold !== "string" || typeof timezone !== "string") throw new Error("INVALID_SLEEP_HABIT_RULE");
  assertTime(threshold); assertTimezone(timezone);
  const instant = ruleType === "sleep_start_before" ? session.data.start_at : session.data.end_at;
  const { localDate, localTime } = localParts(instant, timezone);
  if (localDate < rule.data.active_from || (rule.data.active_to !== null && localDate > rule.data.active_to)) throw new Error("SLEEP_HABIT_RULE_INACTIVE");
  const status = minutes(localTime) <= minutes(threshold) ? "completed" : "missed";
  const action = ruleType === "sleep_start_before" ? "入睡" : "起床";
  return {
    local_date: localDate,
    status,
    observed_local_time: localTime,
    threshold_local_time: threshold,
    rule_type: ruleType,
    explanation: `${action} ${localTime}，规则要求不晚于 ${threshold}，因此判定为${status === "completed" ? "完成" : "未完成"}。`,
    value_json: { duration_minutes: session.data.duration_minutes, observed_local_time: localTime, rule_type: ruleType, session_type: "main_sleep", threshold_local_time: threshold },
  };
}

function localParts(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value;
  return { localDate: `${pick("year")}-${pick("month")}-${pick("day")}`, localTime: `${pick("hour")}:${pick("minute")}` };
}
function minutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour! * 60 + minute!; }
function assertTime(value: string) { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new Error("INVALID_SLEEP_HABIT_TIME"); }
function assertTimezone(value: string) { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { throw new Error("INVALID_SLEEP_HABIT_TIMEZONE"); } }
