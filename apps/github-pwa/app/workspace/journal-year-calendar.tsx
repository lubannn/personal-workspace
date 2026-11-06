"use client";

import { useMemo, useState } from "react";
import { journalMonthDays } from "../../../../src/lib/github-data/journal-entries";
import { journalYearCalendar } from "../../../../src/lib/github-data/journal-year-calendar";
import type { JournalFileStatistics } from "../../../../src/lib/github-data/journal-statistics";

export function JournalYearCalendar({ statistics, complete, knownDates, todayDate, onMonth, onDay, onClose }: {
  statistics: JournalFileStatistics[]; complete: boolean; knownDates: Set<string>; todayDate: string;
  onMonth: (month: string) => void; onDay: (date: string) => void; onClose: () => void;
}) {
  const model = useMemo(() => journalYearCalendar(statistics, todayDate.slice(0, 4), knownDates, complete), [statistics, todayDate, knownDates, complete]);
  const [selected, setSelected] = useState("");
  const year = selected && model.years.includes(selected) ? selected : todayDate.slice(0, 4) || model.years[0];
  return <section className="journal-year-overview" aria-label="全部日历">
    <header className="journal-year-heading"><div><p className="eyebrow">A year in words</p><h3>{year} 年的日记</h3></div><div><span>累计 {model.total.toLocaleString()} 天 · 本年 {model.yearDays[year] ?? 0} 天</span><button type="button" className="text-button" onClick={onClose}>返回日记</button></div></header>
    {!complete ? <p className="journal-load-progress" role="status">正在核对历史记录，当前为已知记录；完成核对后更新准确天数。</p> : null}
    <div className="journal-year-layout"><nav className="journal-year-nav" aria-label="选择日记年份">{model.years.map((value) => <button key={value} type="button" aria-pressed={year === value} onClick={() => setSelected(value)}><strong>{value}</strong><span>{model.yearDays[value]} 天</span></button>)}</nav>
      <div className="journal-year-months">{Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`).map((month, index) => <section className="journal-year-month" key={month} aria-label={`${month} 日记月历`}>
        <header><button type="button" onClick={() => onMonth(month)} aria-label={`查看 ${month} 全月日记`}>{index + 1} 月</button><span>记录 {model.monthDays[month] ?? 0} 天</span></header>
        <div className="journal-year-days">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span className="weekday" key={day}>{day}</span>)}{journalMonthDays(month).map((date, position) => date ? <button type="button" key={date} className={`${model.dates.has(date) ? "has-entry" : ""}${date === todayDate ? " today" : ""}`} aria-label={`${date}，${model.dates.has(date) ? "有" : "无"}日记`} onClick={() => onDay(date)}>{Number(date.slice(-2))}</button> : <span aria-hidden="true" key={`blank-${position}`} />)}</div>
      </section>)}</div>
    </div>
  </section>;
}
