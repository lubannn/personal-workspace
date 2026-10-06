import assert from "node:assert/strict";
import { separatedSyncFixture } from "../apps/auth-worker/src/coros-separated-test-helpers";
import { runCorosSync } from "../apps/auth-worker/src/coros-sync";

// Node process CPU (user + system) includes local SQLite and crypto threads.
// It is not Cloudflare invocation CPU and cannot certify the Free limit.
// Actual OAuth refresh, real MCP SDK, Git adapter/writer, encryption and
// production SQL execute with synthetic responses; no live access is made.
const results = [];
for (const stage of ["hrv-seven-days", "activity-one-detail-checkpoint", "activity-final-detail-and-commit", "hrv-idempotent-replay"] as const) {
  const samples: number[] = []; const calls: number[] = [];
  for (let iteration = 0; iteration < 16; iteration++) {
    const f = await separatedSyncFixture();
    try {
      const now = new Date();
      if (stage !== "hrv-seven-days") await runCorosSync(f.db.env, now, f.dependencies, { forceDue: true });
      if (stage === "activity-final-detail-and-commit") await runCorosSync(f.db.env, now, f.dependencies, { forceDue: true });
      if (stage === "hrv-idempotent-replay") {
        const p = f.db.saved()!.progress; p.health!.backfillNext = "2024-01-01"; p.scheduling = { lastKind: "recent", historySource: "workout" }; f.db.saveProgress(p);
      }
      const requests = f.requests.length, before = process.cpuUsage();
      const outcome = await runCorosSync(f.db.env, now, f.dependencies, { forceDue: true });
      const cpu = process.cpuUsage(before);
      assert.equal(outcome.status, "processed");
      if (stage === "activity-one-detail-checkpoint") { assert.equal(outcome.continuation?.detailsRead, 1); assert.equal(f.commits, 1); }
      if (stage === "hrv-seven-days") assert.equal(outcome.batch?.created, 17);
      samples.push((cpu.user + cpu.system) / 1000); calls.push(f.requests.length - requests);
    } finally { f.db.sqlite.close(); }
  }
  const warm = samples.slice(1).sort((a, b) => a - b);
  results.push({ stage, firstProcessCpuMs: samples[0], warmMedianProcessCpuMs: warm[Math.floor(warm.length / 2)], warmMaxProcessCpuMs: warm.at(-1), syntheticHttpCalls: [...new Set(calls)] });
}
console.log(JSON.stringify({ node: process.version, caveat: "Node CPU is not Cloudflare CPU. Synthetic local HTTP transport and SQLite; no production credentials/data. First sample includes SDK cold work only for the first stage. Must validate deployed invocation outcomes on the existing plan.", results }, null, 2));
