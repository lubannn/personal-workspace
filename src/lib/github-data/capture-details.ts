import { updateWorkspaceRecord } from "./protocol";
import type { CaptureData, CaptureRecord } from "./workspace";

export const CAPTURE_KINDS = ["note", "todo", "schedule", "deadline", "idea", "journal"] as const;
export type CaptureKind = typeof CAPTURE_KINDS[number];
export const CAPTURE_KIND_LABELS: Record<CaptureKind, string> = {
  note: "随记", todo: "待办", schedule: "日程", deadline: "截止待办", idea: "想法", journal: "日记",
};
export type CaptureFields = { rawText: string; kind: CaptureKind; date: string | null; time: string | null; endTime?: string | null; timezone: string };
export type CaptureSuggestion = Omit<CaptureFields, "rawText" | "timezone"> & { warning: string | null; reason: string };

export function isCaptureDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function isCaptureTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function isCaptureTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
function dateInZone(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}
function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function makeDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function numberFromText(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes("十")) {
    const [tens, units] = value.split("十");
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return digits[value] ?? NaN;
}

const PREFIX = /^(随记|笔记|待办|任务|日程|截止|想法|日记|note|todo|idea|journal)\s*[:：]/i;
const PREFIX_KINDS: Record<string, CaptureKind> = { 随记: "note", 笔记: "note", note: "note", 待办: "todo", 任务: "todo", todo: "todo", 日程: "schedule", 截止: "deadline", 想法: "idea", idea: "idea", 日记: "journal", journal: "journal" };
export function captureBody(text: string) { return text.trim().replace(PREFIX, "").trim(); }

export function captureClock(text: string) {
  const pattern = /(?<!\d)(凌晨|早上|上午|中午|下午|晚上)?\s*([\d一二两三四五六七八九十]+)(?:[:：](\d{2})|\s*(?:点|时)(半|[\d一二两三四五六七八九十]+分?)?)(?!\d)/g;
  const matches = [...text.matchAll(pattern)].filter((match) => {
    if (match[1] || match[3] || match[4]) return true;
    const before = text.slice(0, match.index).trimEnd();
    const after = text.slice(match.index! + match[0].length);
    // Chinese 点 also means an amount or a list item: 简单一点 / 三点建议 are not clocks.
    if (/^\s*(?:建议|意见|原因|理由|总结|心得|要点|想法|灵感|要求|问题|要说)/.test(after)) return false;
    if (numberFromText(match[2]) === 1 && /(?:简单|容易|清楚|清晰|明白|好|多|少|慢|快|高|低|小|大|早|晚|省|方便|麻烦|复杂)$/.test(before)) return false;
    return true;
  });
  function read(match: RegExpMatchArray, inheritedPeriod?: string) {
    let hour = numberFromText(match[2]);
    const minute = match[3] ? Number(match[3]) : match[4] === "半" ? 30 : match[4] ? numberFromText(match[4].replace(/分$/, "")) : 0;
    const period = match[1] || inheritedPeriod;
    if (["下午", "晚上"].includes(period ?? "") && hour < 12) hour += 12;
    if (period === "中午" && hour < 11) hour += 12;
    if (["凌晨", "上午", "早上"].includes(period ?? "") && hour === 12) hour = 0;
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return isCaptureTime(time) ? time : null;
  }
  const first = matches[0];
  if (!first) return { time: null, endTime: null, invalid: false };
  const second = matches[1];
  const isRange = second && /^\s*(?:[-–~～]|至|到)\s*$/.test(text.slice(first.index! + first[0].length, second.index));
  const time = read(first);
  const endTime = isRange ? read(second, first[1]) : null;
  return { time, endTime, invalid: !time || Boolean(isRange && (!endTime || endTime === time)) };
}

function classifyCapture(text: string, date: string | null, time: string | null, recurring: boolean): { kind: CaptureKind; reason: string } {
  const prefix = text.trim().match(PREFIX)?.[1].toLowerCase();
  if (prefix) return { kind: PREFIX_KINDS[prefix], reason: "你指定了内容类型" };
  if (/能不能|可不可以|要不要|也许|或许|不如|如果|以后可以|想法|灵感|想到|我在想|考虑一下/.test(text)) return { kind: "idea", reason: "包含探索或构想的表达" };
  if (/取消|不用|不需要|无需|不去|别去/.test(text)) return { kind: "note", reason: "包含取消或否定表达，保留为随记" };
  const future = /明天|后天|下(?:周|星期|月)|将要|准备要/.test(text);
  const retrospective = /已经|刚刚|刚才|完成了|交了|买了|看完了|开完|去了|去过|做完了|参加了|结束了/.test(text);
  if (retrospective && !future) return { kind: "note", reason: "描述已经发生的事情" };
  if (recurring) return { kind: "note", reason: "循环事项需要单独设置，先保留原文" };
  const deadline = /\bDDL\b|截止|截至|[\d一二两三四五六七八九十]\s*(?:个)?(?:工作日|天|周|星期|月|年)\s*(?:内|以内)/i.test(text)
    || Boolean((date || time) && /之前|以前|(?:周|星期)[一二三四五六日天]\s*前|(?:日|号|点|天|周|月|年|\d{1,2}[:：]\d{2})\s*前/.test(text));
  if (deadline) return { kind: "deadline", reason: "包含截止或期限表达" };
  const tentative = /我想|想做|想试|想尝试|以后做|可以考虑|建议/.test(text);
  if (tentative && !time) return { kind: "idea", reason: "表达尚未确定的意愿或建议" };
  const event = /开会|会议|约见|会面|面试|看医生|看牙|就诊|聚餐|约会|参加|出差|航班|火车|高铁|预约|上课|站会/.test(text);
  if (time || (date && event)) return { kind: "schedule", reason: time ? "包含具体时间安排" : "包含日期和日程活动" };
  const action = /^(?:我?要|需要|记得|别忘了?|提醒我|帮我|请|必须|尽快)?\s*(?:买|采购|整理|准备|提交|完成|回复|联系|给.+(?:打电话|发|回)|预约|检查|缴费|交|跑步|运动|学习|阅读|复盘|背|修复|更新|写|做|读|处理|确认|发送|预订|订|打扫)/.test(text);
  const commitment = /记得|别忘|提醒我|必须|需要|待办/.test(text);
  if (action || commitment || (date && /买|提交|整理|完成|回复|准备|处理|复盘|交|跑步|运动|学习|阅读|背单词|打扫|联系/.test(text))) return { kind: "todo", reason: "包含需要执行的行动" };
  return { kind: "note", reason: "没有明确的行动或安排，保留为随记" };
}

// Suggestions are fixed into metadata when saved; relative dates never move when records are read.
export function suggestCapture(text: string, now = new Date(), timezone = "Asia/Shanghai"): CaptureSuggestion {
  const today = dateInZone(now, timezone);
  if (/^(?:日记|journal)\s*[:：]/i.test(text.trim())) return { kind: "journal", date: today, time: null, endTime: null, warning: null, reason: "以日记前缀开头，正文中的日期不改变日记日期" };
  const year = Number(today.slice(0, 4));
  let date: string | null = null;
  let time: string | null = null;
  let warning: string | null = null;
  const full = text.match(/(?<!\d)(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})(?:日|号)?(?!\d)/);
  const monthDay = text.match(/(?<!\d)(\d{1,2})月(\d{1,2})(?:日|号)/);
  const duration = text.match(/([\d一二两三四五六七八九十]+)\s*(?:个)?(工作日|天|周|星期|月|年)\s*(?:内|以内)/);
  const relative = text.match(/大后天|后天|明天|今天|昨天/);
  const weekday = text.match(/(下下|下|本|这)?(?:周|星期)([一二三四五六日天])/);
  const recurring = /每(?:天|周|月|年|个|\d|[一二两三四五六七八九十])/.test(text);
  if (recurring) warning = "检测到循环表达；这里只保存原文，请在任务或习惯中设置循环。";
  if (full) date = makeDate(Number(full[1]), Number(full[2]), Number(full[3]));
  else if (monthDay) {
    date = makeDate(year, Number(monthDay[1]), Number(monthDay[2]));
    if (isCaptureDate(date) && date < today) date = makeDate(year + 1, Number(monthDay[1]), Number(monthDay[2]));
  } else if (duration) {
    const count = numberFromText(duration[1]);
    const unit = duration[2];
    if (count > 0 && count <= 366) {
      if (unit === "月" || unit === "年") {
        const start = new Date(`${today}T00:00:00Z`);
        const day = start.getUTCDate();
        start.setUTCDate(1);
        start.setUTCMonth(start.getUTCMonth() + count * (unit === "年" ? 12 : 1));
        const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
        start.setUTCDate(Math.min(day, lastDay));
        date = start.toISOString().slice(0, 10);
      } else if (unit === "工作日") {
        date = today;
        for (let remaining = count; remaining > 0;) {
          date = addDays(date, 1);
          if (![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) remaining--;
        }
      } else date = addDays(today, count * (["周", "星期"].includes(unit) ? 7 : 1));
    } else warning = "这个相对期限暂未识别，请手动选择日期。";
  } else if (relative) date = addDays(today, ({ 大后天: 3, 后天: 2, 明天: 1, 今天: 0, 昨天: -1 } as Record<string, number>)[relative[0]]);
  else if (weekday && !recurring) {
    const target = "日一二三四五六".indexOf(weekday[2] === "天" ? "日" : weekday[2]);
    const current = new Date(`${today}T00:00:00Z`).getUTCDay();
    const fromMonday = (current + 6) % 7;
    const targetFromMonday = (target + 6) % 7;
    const weeks = weekday[1] === "下下" ? 2 : weekday[1] === "下" ? 1 : 0;
    date = addDays(today, weekday[1] ? targetFromMonday - fromMonday + weeks * 7 : (target - current + 7) % 7);
  }
  if (date && !isCaptureDate(date)) { date = null; warning = "日期无效，请手动选择。"; }
  const clock = captureClock(text);
  time = clock.time;
  if (clock.invalid) warning = "时间无效，请手动选择。";
  if (time && !date && !full && !monthDay && !recurring) date = today;
  if (recurring && !date) time = null;
  const classification = classifyCapture(text, date, time, recurring);
  return { ...classification, date, time, endTime: clock.endTime, warning };
}

export function createCaptureData(fields: CaptureFields, status: CaptureData["status"] = "inbox"): CaptureData {
  const text = fields.rawText.trim();
  if (!text || text.length > 10_000 || !CAPTURE_KINDS.includes(fields.kind)
    || (fields.date !== null && !isCaptureDate(fields.date)) || (fields.time !== null && !isCaptureTime(fields.time))
    || (fields.time !== null && fields.date === null) || !isCaptureTimezone(fields.timezone)) throw new Error("INVALID_CAPTURE_DETAILS");
  return { raw_text: text, status, kind: fields.kind, noted_date: fields.date, noted_time: fields.time, timezone: fields.timezone };
}
export function updateCaptureDetails(record: CaptureRecord, fields: CaptureFields, timestamp?: string): CaptureRecord {
  if (record.deleted_at !== null) throw new Error("CAPTURE_IN_TRASH");
  return updateWorkspaceRecord(record, { ...record.data, ...createCaptureData(fields, record.data.status) }, timestamp);
}
export function captureMatches(record: CaptureRecord, query: string, kind: CaptureKind | "all" = "all") {
  if (kind !== "all" && (record.data.kind ?? "note") !== kind) return false;
  const timezone = record.data.timezone ?? "Asia/Shanghai";
  const dates = [record.data.noted_date, dateInZone(new Date(record.created_at), timezone)].filter(Boolean) as string[];
  const haystack = [record.data.raw_text, CAPTURE_KIND_LABELS[record.data.kind ?? "note"], record.data.noted_time,
    ...dates.flatMap((date) => [date, `${Number(date.slice(5, 7))}月`, `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`,
      new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T00:00:00Z`)).replace("星期", "周")]),
  ].join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((term) => haystack.includes(term.replace("星期", "周")));
}
