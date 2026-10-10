import { describe, expect, it, vi } from "vitest";
import { collectCorosActivityTotals, mapCorosActivityDetail } from "./coros-health-activity";
import { mapCorosWorkouts } from "./coros-sync-mapping";
import { acceptSyncRequest, initialSyncProgress, shiftDate } from "./coros-sync-state";
import type { CorosReadResult, CorosReadTool } from "./coros-read-client";
import { decryptRefreshToken, encryptRefreshToken } from "./security";

// Response layout only; identities, dates and every value are synthetic.
const text = (value: string): CorosReadResult => ({ format: "structured", payload: value });
const iso = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
const observedAt = "2024-02-01T04:00:00Z";
const key = Buffer.alloc(32, 7).toString("base64url");
function list(start: string, end: string, count = 1, duplicate = false, crossMidnight = false) {
  const timestamp = Date.parse(crossMidnight ? "2024-01-02T15:59:00Z" : "2024-01-02T04:00:00Z") / 1000;
  const body = Array.from({ length: count }, (_, i) => `${i + 1}. Hike — 2024-01-02\n   Time Window: startTimestamp=${timestamp} | endTimestamp=${timestamp + 600}\n   Duration: 10:00 | Distance: 1 km\n   LabelId: ${duplicate ? 101 : 101 + i} | SportType: 104`).join("\n\n");
  return text(`Sport Records — ${start} to ${end} (${count} records)\n========================\n\n${body}`);
}
const detail = (gain: number | null = 7, load: number | null = 10) => text(`🏃 Hike Activity Details\n========================================\n\nWorkout Time: 10:00\nDistance: 1 km\nTotal Time: 10:00\nAverage Heart Rate: 100 bpm\nElevation Gain / Loss: ${gain === null ? "No data" : `${gain} m / 8 m`}\nCalories: 60 kcal\nTraining Load: ${load ?? "No data"}\nTraining Focus: Recovery`);
function progress() { const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); p.request = { sequence: 1, through: "2024-02-01" };
  p.health = { ...p.domains.workout }; return p; }
function read(count = 1, duplicate = false, crossMidnight = false) {
  return vi.fn(async (tool: CorosReadTool, args: Record<string, unknown>) => tool === "querySportRecords"
    ? list(iso(args.startDate), iso(args.endDate), count, duplicate, crossMidnight) : detail(Number(args.labelId) - 100));
}

describe("complete daily activity evidence", () => {
  it("checkpoints encrypted details individually and resumes them after an interrupted later read", async () => {
    const p = progress(), reader = read(3);
    let committed: string | undefined;
    const checkpoint = vi.fn(async () => { committed = p.health!.encryptedActivityCache; });
    reader.mockImplementation(async (tool, args) => {
      if (tool === "querySportRecords") return list(iso(args.startDate), iso(args.endDate), 3);
      if (args.labelId === "102") throw new Error("COROS_READ_TIMEOUT");
      return detail(1, 10);
    });
    await expect(collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, observedAt, key, checkpoint)).rejects.toThrow("COROS_READ_TIMEOUT");
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await decryptRefreshToken(committed!, key)).entries.map(([id]: [string]) => id)).toEqual(["workout:101"]);
    const resumed = progress(); resumed.health!.encryptedActivityCache = committed;
    const resumedReader = read(3);
    await collectCorosActivityTotals(resumedReader, "2024-01-02", "2024-01-02", resumed, async () => {}, observedAt, key);
    expect(resumedReader.mock.calls.filter(([tool]) => tool === "getActivityDetail").map(([, args]) => args.labelId)).toEqual(["102", "103"]);
    expect(resumed.health?.backfillThrough).toBeNull();
  });
  it("maps exact ascent and per-activity load, and rejects units or mismatching duration", () => {
    const workout = mapCorosWorkouts(list("2024-01-01", "2024-01-03"), { startDate: "2024-01-01", endDate: "2024-01-03", timezone: "Asia/Shanghai" }).items[0];
    expect(mapCorosActivityDetail(detail(), workout)).toEqual({ elevationGainMeters: 7, trainingLoad: 10 });
    expect(() => mapCorosActivityDetail(text(String(detail().payload).replace("7 m / 8 m", "7 ft / 8 ft")), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(text(String(detail().payload).replace("Total Time: 10:00", "Total Time: 15:00")), workout)).toThrow("MISMATCH");
  });
  it.each([[900, "Walk"], [902, "Floor Climb"]] as const)("accepts verified active-only layout %s %s and standalone ascent", (sport, name) => {
    const row = text(String(list("2024-01-01", "2024-01-03").payload).replace("Hike", name).replace("SportType: 104", `SportType: ${sport}`));
    const workout = mapCorosWorkouts(row, { startDate: "2024-01-01", endDate: "2024-01-03", timezone: "Asia/Shanghai" }).items[0];
    const body = String(detail().payload).replace("🏃 Hike", `🚶 ${name}`).replace("Total Time: 10:00\n", "").replace("Elevation Gain / Loss: 7 m / 8 m", "Elevation Gain: 7 m");
    expect(mapCorosActivityDetail(text(body), workout)).toEqual({ elevationGainMeters: 7, trainingLoad: 10 });
    expect(() => mapCorosActivityDetail(text(body.replace("10:00", "11:00")), workout)).toThrow("MISMATCH");
    expect(() => mapCorosActivityDetail(text(body.replace("7 m", "7 ft")), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(text(body.replace(`🚶 ${name}`, "🏃 Hike")), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(text(`${body}\nElevation Gain / Loss: 8 m / 2 m`), workout)).toThrow("MISMATCH");
    expect(mapCorosActivityDetail(text(body.replace("Elevation Gain: 7 m\n", "")), workout).elevationGainMeters).toBeNull();
    workout.candidate.metrics_json.moving_seconds = null;
    expect(() => mapCorosActivityDetail(text(body), workout)).toThrow("FORMAT_UNSUPPORTED");
  });
  it("deduplicates lists, independently retains valid load when ascent is missing, and caches encrypted normalized facts", async () => {
    const p = progress(), reader = read(2, true), active = vi.fn(async () => {});
    reader.mockImplementation(async (tool, args) => tool === "querySportRecords" ? list(iso(args.startDate), iso(args.endDate), 2, true) : detail(null, 10));
    const result = await collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, active, observedAt, key);
    expect(result.items.map(item => [item.candidate.metric_type, item.candidate.value])).toEqual([["training_load", 10]]);
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail")).toHaveLength(1);
    expect(p.health!.encryptedActivityCache).toBeTruthy(); expect(p.health!.encryptedActivityCache).not.toMatch(/elevation|trainingLoad|workout:|Heart|Calories/);
    reader.mockClear(); await collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, active, observedAt, key);
    expect(reader).toHaveBeenCalledTimes(1); // authenticated list refreshed; historical detail reused
  });
  it("resumes a four-detail batch from encrypted cache before advancing the daily checkpoint", async () => {
    const p = progress(), reader = read(5);
    p.health!.encryptedActivityCache = await encryptRefreshToken(JSON.stringify({ version: 1, timezone: "Asia/Shanghai",
      entries: Array.from({ length: 256 }, (_, index) => [`workout:${1000 + index}`, { signature: "synthetic_other", date: "2024-01-31", requestSequence: 1, elevationGainMeters: 1, trainingLoad: 1 }]) }), key);
    await expect(collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, observedAt, key)).resolves.toMatchObject({ items: [], continuation: { detailsRead: 4 } });
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail")).toHaveLength(4);
    const cached = JSON.parse(await decryptRefreshToken(p.health!.encryptedActivityCache!, key));
    expect(cached.entries).toHaveLength(256); expect(cached.entries.some(([id]: [string]) => id === "workout:101")).toBe(true);
    reader.mockClear(); const result = await collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, observedAt, key);
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail")).toHaveLength(1);
    expect(result.items.map(item => item.candidate.value)).toEqual([15, 50]);
    expect(reader.mock.calls.filter(([tool]) => tool === "querySportRecords")).toHaveLength(0);
    expect(JSON.parse(await decryptRefreshToken(p.health!.encryptedActivityCache!, key)).pendingLists).toEqual([]);
  });
  it("refreshes a pending list when its observation changes or its cache expires", async () => {
    for (const invalidate of ["new-observation", "expiry"] as const) {
      const p = progress(), reader = read(5);
      await collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, observedAt, key);
      if (invalidate === "new-observation") p.request = { sequence: 99, through: "2024-01-02" };
      else {
        const cache = JSON.parse(await decryptRefreshToken(p.health!.encryptedActivityCache!, key));
        cache.pendingLists[0].savedAt -= 6 * 60_000;
        p.health!.encryptedActivityCache = await encryptRefreshToken(JSON.stringify(cache), key);
      }
      reader.mockClear();
      await collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, observedAt, key);
      expect(reader.mock.calls.filter(([tool]) => tool === "querySportRecords")).toHaveLength(1);
    }
  });
  it("resumes today's pending details across another request, then refreshes after the observation completes", async () => {
    const p = progress(), reader = read(5), date = new Date("2024-01-02T04:00:00Z");
    p.request = { sequence: 1, through: "2024-01-02" }; p.health!.recentNext = "2024-01-02";
    await expect(collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, date.toISOString(), key)).resolves.toMatchObject({ items: [], continuation: { detailsRead: 4 } });
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail")).toHaveLength(4);
    acceptSyncRequest(p, { request_seq: 2, requested_through: "2024-01-02" }, date);
    reader.mockClear();
    await collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, date.toISOString(), key);
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail").map(([, args]) => args.labelId)).toEqual(["105"]);
    p.health!.recentRequestSequence = 2; p.health!.recentNext = null;
    acceptSyncRequest(p, { request_seq: 3, requested_through: "2024-01-02" }, date);
    reader.mockClear();
    await expect(collectCorosActivityTotals(reader, "2024-01-02", "2024-01-02", p, async () => {}, date.toISOString(), key)).resolves.toMatchObject({ items: [], continuation: { detailsRead: 4 } });
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail").map(([, args]) => args.labelId)).toEqual(["101", "102", "103", "104"]);
    expect(p.health!.backfillThrough).toBeNull();
  });

  it("retains both unfinished recent and historical detail windows when the encrypted cache is full", async () => {
    const p = progress();
    p.health!.encryptedActivityCache = await encryptRefreshToken(JSON.stringify({ version: 1, timezone: "Asia/Shanghai",
      entries: Array.from({ length: 256 }, (_, i) => [`workout:${1000 + i}`, { signature: "synthetic-other", date: "2024-01-31", requestSequence: 1, elevationGainMeters: 1, trainingLoad: 1 }]) }), key);
    const reader = vi.fn(async (tool: CorosReadTool, args: Record<string, unknown>) => {
      if (tool !== "querySportRecords") return detail(1, 10);
      const recent = args.startDate === "20240119";
      let body = String(list(iso(args.startDate), iso(args.endDate), 7).payload);
      if (recent) {
        const old = Date.parse("2024-01-02T04:00:00Z") / 1000, next = Date.parse("2024-01-20T04:00:00Z") / 1000;
        body = body.replaceAll("2024-01-02", "2024-01-20").replaceAll(`startTimestamp=${old}`, `startTimestamp=${next}`)
          .replaceAll(`endTimestamp=${old + 600}`, `endTimestamp=${next + 600}`).replace(/LabelId: (\d+)/g, (_, id) => `LabelId: ${Number(id) + 100}`);
      }
      return text(body);
    });
    const collect = (date: string) => collectCorosActivityTotals(reader, date, date, p, async () => {}, observedAt, key);
    expect((await collect("2024-01-02")).continuation?.detailsRead).toBe(4);
    expect((await collect("2024-01-20")).continuation?.detailsRead).toBe(4);
    reader.mockClear();
    expect((await collect("2024-01-02")).continuation).toBeUndefined();
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail").map(([, args]) => args.labelId)).toEqual(["105", "106", "107"]);
    reader.mockClear();
    expect((await collect("2024-01-20")).continuation).toBeUndefined();
    expect(reader.mock.calls.filter(([tool]) => tool === "getActivityDetail").map(([, args]) => args.labelId)).toEqual(["205", "206", "207"]);
    const cache = JSON.parse(await decryptRefreshToken(p.health!.encryptedActivityCache!, key));
    expect(cache.entries).toHaveLength(256); expect(cache.pendingWindows).toHaveLength(0);
  });

  it("keeps a capped raw list incomplete even when its rows deduplicate to one activity", async () => {
    const p = progress(), reader = read(20, true);
    await expect(collectCorosActivityTotals(reader, "2024-01-02", "2024-01-08", p, async () => {}, observedAt, key)).rejects.toThrow("WINDOW_TRUNCATED");
    expect(reader.mock.calls.every(([tool]) => tool === "querySportRecords")).toBe(true);
    const lastArgs = reader.mock.calls.at(-1)![1];
    expect(lastArgs).toMatchObject({ startDate: "20240101", endDate: "20240103", limit: 20 });
  });
  it("uses local epoch start date for cross-midnight activities without invented daily splitting", async () => {
    const result = await collectCorosActivityTotals(read(1, false, true), "2024-01-02", "2024-01-03", progress(), async () => {}, observedAt, key);
    expect(result.items.map(item => [item.candidate.local_date, item.candidate.metric_type, item.candidate.value])).toEqual([
      ["2024-01-02", "elevation_gain", 1], ["2024-01-02", "training_load", 10], ["2024-01-03", "elevation_gain", 0], ["2024-01-03", "training_load", 0],
    ]);
    expect(shiftDate(result.through, 1)).toBe("2024-01-04");
  });
});
