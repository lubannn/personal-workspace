// Reuse immutable formatters without weakening native timezone validation.
// Bound memory even when validating user-provided import timezones.
const formatters = new Map<string, Intl.DateTimeFormat>();
export function healthTimezoneFormatter(timezone: string, dateOnly = false) {
  if (typeof timezone !== "string" || !timezone) throw new RangeError("INVALID_HEALTH_TIMEZONE");
  const key = `${dateOnly ? "date" : "validate"}:${timezone}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", { timeZone: timezone,
      ...(dateOnly ? { year: "numeric", month: "2-digit", day: "2-digit" } as const : {}) });
    if (formatters.size >= 16) formatters.delete(formatters.keys().next().value!);
    formatters.set(key, formatter);
  }
  return formatter;
}
