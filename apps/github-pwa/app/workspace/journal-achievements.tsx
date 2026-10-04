"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { journalAchievements, type JournalAchievement } from "../../../../src/lib/github-data/journal-achievements";
import { JournalAchievementNoticeTracker } from "../../../../src/lib/github-data/journal-achievement-notices";
import type { JournalFileStatistics } from "../../../../src/lib/github-data/journal-statistics";

const number = (value: number) => value.toLocaleString("zh-CN");

function Medal({ badge }: { badge: JournalAchievement }) {
  const writing = badge.series.includes("writing") || badge.series === "words" || badge.series === "thousand-days";
  return <svg className={`journal-medal${badge.earned ? " earned" : ""}`} viewBox="0 0 100 112" aria-hidden="true" focusable="false">
    <path className="medal-ribbon" d="M32 74v30l18-10 18 10V74" />
    <circle className="medal-face" cx="50" cy="45" r="36" />
    <circle className="medal-ring" cx="50" cy="45" r="30" />
    {writing ? <><path className="medal-symbol" d="M30 33q10-4 20 2 10-6 20-2v25q-10-4-20 2-10-6-20-2zM50 35v25" /><path className="medal-symbol" d="m36 40 8 2m-8 5 8 2m12-7 8-2m-8 9 8-2" /></> : badge.series === "calendar" || badge.series === "monthly" ? <><path className="medal-symbol" d="M34 32h32v28H34zM34 40h32M41 28v8m18-8v8m-17 12h2m10 0h2m-14 7h2m10 0h2" /></> : <><path className="medal-symbol" d="M34 50a16 16 0 0 1 32 0M29 51h42M35 57h30M41 63h18M50 24v7m-20 3 5 5m35-5-5 5" /></>}
    <path className="medal-symbol medal-sprig" d="M23 57q4 13 15 17m-11-11-6-1m11 7-6 1m51-13q-4 13-15 17m11-11 6-1m-11 7 6 1" />
    <text x="50" y="93" textAnchor="middle">{badge.level}</text>
  </svg>;
}

function BadgeCard({ badge }: { badge: JournalAchievement }) {
  return <li className={`journal-badge-card${badge.earned ? " earned" : ""}`}>
    <Medal badge={badge} />
    <span className="journal-badge-level">{badge.level} 级 · {badge.earned ? "已获得" : "进行中"}</span>
    <h5>{badge.name}</h5><p>{badge.requirement}</p>
    <div className="journal-badge-progress"><span>{badge.basis === "streak" ? "历史最长 " : ""}{number(Math.min(badge.value, badge.target))} / {number(badge.target)} {badge.unit}</span><progress aria-label={`${badge.name}进度`} value={Math.min(badge.value, badge.target)} max={badge.target} /></div>
  </li>;
}

export function JournalAchievementNotice({ badges, onDismiss }: { badges: JournalAchievement[]; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused || badges.length === 0) return;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [badges, hovered, focused, onDismiss]);
  if (badges.length === 0) return null;
  return <aside className="journal-achievement-notice" aria-label="新勋章提醒"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onDismiss(); } }}>
    <Medal badge={badges[0]} />
    <div className="journal-achievement-notice-content" role="status" aria-live="polite" aria-atomic="true">
      <strong>获得新勋章{badges.length > 1 ? ` · ${number(badges.length)} 枚` : ""}</strong>
      <ul>{badges.map((badge) => <li key={badge.id}><span>{badge.name}</span><small>{badge.level} 级</small></li>)}</ul>
    </div>
    <button type="button" className="journal-achievement-notice-close" onClick={onDismiss} aria-label="关闭新勋章提示">×</button>
  </aside>;
}

export function JournalAchievements({ statistics, complete, todayDate, connected }: { statistics: JournalFileStatistics[]; complete: boolean; todayDate: string; connected: boolean }) {
  // Reuse the already-verified per-file summary. This component performs no
  // I/O and never asks for journal bodies or a separate achievement cache.
  const records = useMemo(() => complete && connected ? journalAchievements(statistics, todayDate) : null, [complete, connected, statistics, todayDate]);
  const tracker = useRef(new JournalAchievementNoticeTracker());
  const [notice, setNotice] = useState<JournalAchievement[]>([]);
  const dismissNotice = useCallback(() => setNotice([]), []);
  useEffect(() => {
    let current = true;
    // Deferring observation as well as publication preserves notifications under
    // Strict Mode's setup/cleanup replay and cancels superseded snapshots.
    queueMicrotask(() => {
      if (!current) return;
      if (!connected) { tracker.current.reset(); setNotice([]); return; }
      if (!records) return;
      const ids = tracker.current.observe(records.earned.map((badge) => badge.id));
      setNotice((previous) => {
        const retained = previous.filter((badge) => records.earned.some((earned) => earned.id === badge.id));
        if (!ids.length && retained.length === previous.length) return previous;
        return [...retained, ...records.earned.filter((badge) => ids.includes(badge.id))];
      });
    });
    return () => { current = false; };
  }, [connected, records]);
  const next = records?.series.flatMap((group) => {
    const badge = group.badges.find((item) => !item.earned);
    return badge ? [badge] : [];
  }).sort((a, b) => b.value / b.target - a.value / a.target).slice(0, 3) ?? [];

  return <section className="journal-achievements" aria-labelledby="journal-achievements-title">
    {records && notice.length > 0 ? <JournalAchievementNotice badges={notice.filter((badge) => records.earned.some((earned) => earned.id === badge.id))} onDismiss={dismissNotice} /> : null}
    <div className="journal-achievements-heading"><div><p className="eyebrow">Every page counts</p><h3 id="journal-achievements-title">日记记录与勋章</h3></div><span className="journal-achievements-earned" aria-live="polite">{records ? `已获得 ${records.earned.length} / ${records.count} 枚` : "勋章待核对"}</span></div>
    {!records ? <p className="journal-achievements-pending">{connected ? "统计核对完成后，历史记录会一起计入勋章。" : "连接后查看你的记录与勋章。"}</p> : <>
      <dl className="journal-achievement-metrics">
        {[{ name: "累计记录", value: records.totals.days, unit: "天" }, { name: "累计日记", value: records.totals.entries, unit: "篇" }, { name: "累计写作", value: records.totals.words, unit: "字" }, { name: "每日千字", value: records.totals.thousandDays, unit: "天" }].map((metric) => <div key={metric.name}><dt>{metric.name}</dt><dd>{number(metric.value)}<span>{metric.unit}</span></dd></div>)}
      </dl>
      <div className="journal-achievement-streaks" aria-label="连续记录"><span>当前连续 <strong>{number(records.daily.current)}</strong> 天</span><span>历史最长 <strong>{number(records.daily.longest)}</strong> 天 · <strong>{number(records.weekly.longest)}</strong> 周 · <strong>{number(records.monthly.longest)}</strong> 月</span></div>
      {records.earned.length ? <ul className="journal-earned-medals" aria-label="已获得勋章">{records.earned.slice(-6).map((badge) => <li key={badge.id}><Medal badge={badge} /><span>{badge.name}</span></li>)}{records.earned.length > 6 ? <li className="journal-more-medals">还有 {records.earned.length - 6} 枚<br />在完整勋章中查看</li> : null}</ul> : <p className="journal-achievements-pending">每一篇都是积累，第一枚勋章正在路上。</p>}
      {next.length ? <div className="journal-next-goals" aria-label="下一目标">{next.map((badge) => <div key={badge.id}><span>下一目标 · {badge.name}</span><strong>{badge.basis === "streak" ? `历史最长 ${number(badge.value)} / ${number(badge.target)} ${badge.unit}` : `还差 ${number(badge.target - badge.value)} ${badge.unit}`}</strong><progress aria-label={`${badge.name}进度`} value={badge.value} max={badge.target} /></div>)}</div> : null}
      <details className="journal-badge-collection"><summary>查看完整记录与勋章 <span>{records.count} 枚 · {records.series.length} 个系列</span></summary><div className="journal-badge-series">{records.series.map((group) => <section key={group.id} aria-labelledby={`journal-badge-${group.id}`}><div className="journal-badge-series-heading"><h4 id={`journal-badge-${group.id}`}>{group.name}</h4><span>{group.badges.filter((badge) => badge.earned).length} / {group.badges.length}{group.current !== undefined ? ` · 当前连续 ${number(group.current)} ${group.unit} · 最长 ${number(group.longest!)} ${group.unit}` : ""}</span></div><ul className="journal-badge-grid">{group.badges.map((badge) => <BadgeCard key={badge.id} badge={badge} />)}</ul></section>)}</div></details>
    </>}
  </section>;
}
