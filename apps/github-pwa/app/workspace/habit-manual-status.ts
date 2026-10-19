import type { HabitRecord } from "../../../../src/lib/github-data/habits";
import type { HabitRuleRecord } from "../../../../src/lib/github-data/habit-rules";

/** Keep the explicit status picker scoped to bedtime/wake habits, including renamed rule-assisted ones. */
export function supportsManualSleepStatus(habit: HabitRecord, rules: HabitRuleRecord[]) {
  return habit.data.name.trim() === "早起" || habit.data.name.trim() === "早睡"
    || rules.some(rule => rule.deleted_at === null && rule.data.habit_id === habit.id
      && (rule.data.rule_type === "sleep_start_before" || rule.data.rule_type === "wake_before"));
}
