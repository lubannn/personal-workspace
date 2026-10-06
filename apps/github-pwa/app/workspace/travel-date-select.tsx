"use client";

import { useState } from "react";
import { isTravelDate } from "../../../../src/lib/github-data/travel-visits";

type DateParts = { year: string; month: string; day: string };
const pad = (number: number) => String(number).padStart(2, "0");
const validYear = (year: string) => /^\d{4}$/.test(year) && Number(year) >= 1;

export function travelDateParts(value: string): DateParts {
  if (!isTravelDate(value)) return { year: "", month: "", day: "" };
  const [year, month, day] = value.split("-");
  return { year, month, day };
}

export function travelMonthDays(year: string, month: string): number {
  if (!validYear(year) || !/^(0[1-9]|1[0-2])$/.test(month)) return 0;
  for (let day = 31; day >= 28; day--) if (isTravelDate(`${year}-${month}-${pad(day)}`)) return day;
  return 0;
}

export function changeTravelDatePart(parts: DateParts, part: keyof DateParts, value: string): DateParts {
  const next = { ...parts, [part]: value };
  const days = travelMonthDays(next.year, next.month);
  // Preserve an unselected day; only clamp an existing day after changing year/month.
  if (days && Number(next.day) > days) next.day = pad(days);
  return next;
}

export function travelDateFromParts(parts: DateParts): string {
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return isTravelDate(date) ? date : "";
}

export function TravelDateSelect({ label, value, min = "", invalid = false, onChange, onInvalid }: {
  label: string; value: string; min?: string; invalid?: boolean;
  onChange: (value: string) => void; onInvalid: () => void;
}) {
  const [draft, setDraft] = useState(() => ({ parts: travelDateParts(value), value }));
  const parts = value === draft.value ? draft.parts : travelDateParts(value);
  // A parent may move the end date to a new start date. Reset parts only when
  // that complete value changes, retaining partially selected empty dates.
  if (value !== draft.value) setDraft({ parts, value });
  const days = travelMonthDays(parts.year, parts.month);
  function change(part: keyof DateParts, nextValue: string) {
    const next = changeTravelDatePart(parts, part, nextValue);
    const date = travelDateFromParts(next);
    setDraft({ parts: next, value: date });
    onChange(date);
  }
  return <div className="travel-date-control" role="group" aria-label={label}>
    <span>{label}</span>
    <div className="travel-date-parts">
      <label><span>年</span><input aria-label={`${label}年`} required inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} placeholder="2026" value={parts.year}
        aria-invalid={invalid || (parts.year.length === 4 && !validYear(parts.year)) ? true : undefined}
        onInvalid={onInvalid} onChange={event => { event.target.setCustomValidity(event.target.value.length === 4 && !validYear(event.target.value) ? "年份请输入 0001–9999。" : ""); change("year", event.target.value); }} /></label>
      <label><span>月</span><select aria-label={`${label}月`} required value={parts.month} onInvalid={onInvalid} onChange={event => change("month", event.target.value)}>
        <option value="">月</option>{Array.from({ length: 12 }, (_, i) => <option value={pad(i + 1)} key={i}>{i + 1}月</option>)}
      </select></label>
      <label><span>日</span><select aria-label={`${label}日`} required disabled={!days} value={parts.day} aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? "travel-date-error" : undefined} onInvalid={onInvalid} onChange={event => change("day", event.target.value)}>
        <option value="">日</option>{Array.from({ length: days || 31 }, (_, i) => {
          const day = pad(i + 1);
          return <option value={day} key={day} disabled={Boolean(min && days && `${parts.year}-${parts.month}-${day}` < min)}>{i + 1}日</option>;
        })}
      </select></label>
    </div>
  </div>;
}
