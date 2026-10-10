import { healthLocalParts, type SleepRecordRow, type WorkoutRecordRow } from "./health-records";
import { buildSleepCalendarDays } from "./sleep-calendar";
import { buildWorkoutCalendarDays } from "./workout-calendar";

export type ExerciseAdvice = {
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
  let advice: ExerciseAdvice;
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
  // Tomorrow is a tentative plan from facts already recorded today. Never
  // use a future-dated workout or invent tomorrow's sleep/recovery state.
  let tomorrowAdvice: ExerciseAdvice;
  if (shortSleep || poorSleep) {
    tomorrowAdvice = { mode: "recovery", title: "明天先预留恢复时间", suggestion: "可先安排 10–20 分钟轻松散步或舒缓活动；若明天仍疲惫就休息，感觉恢复后再调整。",
      reason: `今天的睡眠记录提示需要关注恢复：${advice.reason}` };
  } else if (todaySeconds >= 60 * 60) {
    tomorrowAdvice = { mode: "gentle", title: "明天以轻松活动为起点", suggestion: "可预留散步或轻柔活动 15–20 分钟，明天根据睡眠、肌肉疲劳和体感决定是否继续。",
      reason: "今天已记录至少 60 分钟运动；时长不代表强度，先为明天留出恢复余地。" };
  } else if (!sleep || (sleep.score === null && (sleep.asleepSeconds === null || sleep.hasIncompleteDuration))) {
    tomorrowAdvice = { mode: "gentle", title: "明天先安排轻量活动", suggestion: "可先预留散步 10–20 分钟，明天身体感觉良好时再开始，疲惫时缩短或休息。",
      reason: "今天的睡眠评分或完整实际睡眠时长不足，暂不预判明天的恢复状态。" };
  } else {
    tomorrowAdvice = { mode: "regular", title: "明天可预留适量活动时间", suggestion: "若明天睡眠和体感良好，可安排快走 20–30 分钟，保持能说话的强度，也可选择熟悉的轻松活动。",
      reason: todayWorkouts.length ? `今天已记录 ${todayWorkouts.length} 次运动，先为明天安排可调整的轻量活动。` : "今天尚未记录运动，先预留一段可调整的活动时间；缺少记录不代表未运动。" };
  }
  const tomorrow = { date: shift(1), advice: tomorrowAdvice,
    note: "这是基于今天已入库记录的预安排；明天请结合新的睡眠记录和体感调整。" };
  return { tomorrow, todayWorkouts, todaySeconds, recentCount: days.reduce((sum, day) => sum + day.workouts.length, 0), recentDays: days.length,
    recentSeconds: days.reduce((sum, day) => sum + day.totalSeconds, 0), sleep, advice };
}
