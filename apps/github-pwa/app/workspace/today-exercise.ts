import { healthLocalParts, type SleepRecordRow, type WorkoutRecordRow } from "./health-records";
import { buildSleepCalendarDays } from "./sleep-calendar";
import { buildWorkoutCalendarDays } from "./workout-calendar";

export type TodayExerciseAdvice = {
  mode: "recovery" | "done" | "gentle" | "regular";
  title: string; suggestion: string; reason: string;
};

export function buildTodayExercise(today: string, timezone: string, sleepRows: SleepRecordRow[], workoutRows: WorkoutRecordRow[]) {
  const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
  const from = shift(-6), yesterday = shift(-1);
  const recent = workoutRows.filter(row => row.source.kind !== "unknown" && healthLocalParts(row.startAt, timezone).date >= from && healthLocalParts(row.startAt, timezone).date <= today);
  const days = buildWorkoutCalendarDays(recent, timezone);
  const todayWorkouts = days.find(day => day.date === today)?.workouts ?? [];
  const todaySeconds = days.find(day => day.date === today)?.totalSeconds ?? 0;
  const yesterdaySeconds = days.find(day => day.date === yesterday)?.totalSeconds ?? 0;
  const sleep = buildSleepCalendarDays(sleepRows.filter(row => row.source.kind !== "unknown")).find(day => day.date === today);
  // Only complete actual-asleep totals inform duration advice. Elapsed windows,
  // missing data and older nights must never be interpreted as recovered sleep.
  const shortSleep = Boolean(sleep && !sleep.hasIncompleteDuration && sleep.asleepSeconds !== null && sleep.asleepSeconds < 6 * 3600);
  const poorSleep = sleep?.grade === "poor";
  let advice: TodayExerciseAdvice;
  if (shortSleep || poorSleep) {
    advice = { mode: "recovery", title: "今天以轻松恢复为主", suggestion: "如果感觉舒适，可散步 10–20 分钟或轻柔活动；疲惫时休息，暂缓高强度训练。",
      reason: [poorSleep ? `当天睡眠评分 ${sleep!.score}，等级欠佳` : "", shortSleep ? "当天已记录的实际睡眠少于 6 小时" : ""].filter(Boolean).join("；") + "。" };
  } else if (todayWorkouts.length) {
    advice = { mode: "done", title: "今天已有运动记录", suggestion: "余下时间以轻松活动和恢复为主，是否继续运动按体感决定，无需为了补时长追加训练。", reason: `健康模块已记录今天 ${todayWorkouts.length} 次运动。` };
  } else if (yesterdaySeconds >= 60 * 60) {
    advice = { mode: "gentle", title: "今天可以安排轻松活动", suggestion: "可选择散步或舒缓活动 15–20 分钟，按疲劳程度缩短或休息。", reason: "昨天已记录至少 60 分钟运动；时长不代表强度，今天先关注恢复感受。" };
  } else if (!sleep || (sleep.score === null && (sleep.asleepSeconds === null || sleep.hasIncompleteDuration))) {
    advice = { mode: "gentle", title: "先从轻松活动开始", suggestion: "若身体感觉良好，可先散步 10–20 分钟，再按体感调整。", reason: "当天睡眠评分或完整实际睡眠时长不足，暂不判断恢复状态。" };
  } else {
    advice = { mode: "regular", title: "今天可以安排适量运动", suggestion: "若身体感觉良好，可快走 20–30 分钟，保持能说话的强度，也可换成熟悉的轻松活动。", reason: "当天有睡眠记录，今天尚未记录运动；建议是轻量起点，可按体感调整。" };
  }
  return { todayWorkouts, todaySeconds, recentCount: days.reduce((sum, day) => sum + day.workouts.length, 0), recentDays: days.length,
    recentSeconds: days.reduce((sum, day) => sum + day.totalSeconds, 0), sleep, advice };
}
