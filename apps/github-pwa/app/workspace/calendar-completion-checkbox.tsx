"use client";

import type { CalendarEventRecord } from "../../../../src/lib/github-data/calendar-events";

export function CalendarCompletionCheckbox({ event, disabled, onChange }: {
  event: CalendarEventRecord;
  disabled: boolean;
  onChange: (completed: boolean) => void;
}) {
  return <label className="calendar-completion-control" title={event.deleted_at !== null || event.data.status !== "confirmed" ? "恢复日程后可修改完成状态" : undefined}>
    <input className="calendar-completion-checkbox" type="checkbox" checked={event.data.completed} disabled={disabled}
      aria-label={`${event.data.completed ? "取消完成日程" : "完成日程"}：${event.data.title}`}
      onChange={(event) => onChange(event.target.checked)} />
  </label>;
}
