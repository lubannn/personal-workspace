import type { CSSProperties } from "react";
import { recentHabitCheckInDates, type HabitCheckInStatus } from "../../../../src/lib/github-data/habit-check-ins";
import { habitYearWeeks } from "./habit-calendar";
import type { SyncedHabit } from "./page-model";

type Props = {
  year: string;
  todayDate: string;
  habits: SyncedHabit[];
  statuses: Map<string, Map<string, HabitCheckInStatus>>;
  editable: boolean;
  disabled: boolean;
  onCheckIn: (item: SyncedHabit, date: string, status: HabitCheckInStatus) => Promise<boolean>;
};
const LABELS = { completed: "已完成", missed: "未完成", skipped: "已跳过", unknown: "未打卡", none: "未打卡" };

export function HabitYearHeatmap({ year, todayDate, habits, statuses, editable, disabled, onCheckIn }: Props) {
  const weeks = habitYearWeeks(year);
  const recent = new Set(recentHabitCheckInDates(todayDate));
  const style = { "--habit-year-weeks": weeks.length, minWidth: 174 + weeks.length * 15 } as CSSProperties;
  return <div className="habit-table-scroll" role="region" aria-label={`${year} 年每日打卡热力图，窄屏可左右滚动`} tabIndex={0}>
    <table className="habit-table habit-year-heatmap-table" style={style}>
      <thead><tr><th scope="col" className="habit-name-cell">事项名称</th><th scope="col"><div className="habit-year-months"><span className="habit-sr-only">全年每日记录</span>{weeks.map((week, index) => week.monthLabel ? <span key={index} style={{ gridColumn: index + 2 }}>{week.monthLabel}</span> : null)}</div></th></tr></thead>
      <tbody>{habits.map(item => <tr key={item.record.id}>
        <th scope="row" className="habit-name-cell"><div className="habit-name-content"><strong title={item.record.data.name}>{item.record.data.name}</strong>{item.record.data.status === "paused" ? <small>暂停</small> : null}</div></th>
        <td><div className="habit-year-days">
          <div className="habit-year-weekdays" aria-hidden="true">{["一", "", "三", "", "五", "", "日"].map((label, i) => <span key={i}>{label}</span>)}</div>
          {weeks.map((week, index) => <div className="habit-year-week" key={index}>{week.days.map((date, weekday) => {
            if (!date) return <span className="habit-year-padding" aria-hidden="true" key={`padding-${weekday}`} />;
            const future = date > todayDate;
            const status = future ? "none" : statuses.get(item.record.id)?.get(date) ?? "none";
            const label = `${item.record.data.name} · ${date} · ${future ? "未到日期" : LABELS[status]}`;
            const content = status === "missed" ? "×" : status === "skipped" ? "−" : null;
            const props = { className: "habit-day", "data-status": status, "data-future": future, "data-today": date === todayDate, title: label };
            return editable && recent.has(date) ? <button {...props} key={date} type="button" aria-label={`${label}，${status === "completed" ? "撤销打卡" : "打卡"}`} aria-pressed={status === "completed"} disabled={disabled || item.record.data.status !== "active" || (item.record.data.end_date !== null && date > item.record.data.end_date)} onClick={() => void onCheckIn(item, date, status === "completed" ? "unknown" : "completed")}>{content}</button>
              : <span {...props} key={date} role="img" aria-label={label}>{content}</span>;
          })}</div>)}
        </div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
