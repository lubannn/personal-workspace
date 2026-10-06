import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { corosSyncDependenciesWithFetch } from "./coros-sync";
import { nextHealthSyncWindow } from "./coros-health-sync";
import { initialSyncProgress, shiftDate, syncProgressDomains } from "./coros-sync-state";
import { encryptRefreshToken } from "./security";
import { syncTestDatabase } from "./coros-sync-test-helpers";

// All identities, values, keys and endpoints' responses are synthetic. The
// production OAuth, MCP SDK, Git adapter/writer and D1 SQL run unchanged.
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
const origin = "https://mcpcn.coros.com", resource = `${origin}/mcp`;
const sha = (value: string) => createHash("sha1").update(value).digest("hex");
const iso = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
export async function separatedSyncFixture() {
  let db = syncTestDatabase(); db.connection(); db.env.GITHUB_APP_PRIVATE_KEY = privateKey; db.env.TOKEN_ENCRYPTION_KEY = encryptionKey;
  db.sqlite.prepare("UPDATE coros_connections SET encrypted_refresh_token = ?").run(await encryptRefreshToken("synthetic-refresh", encryptionKey));
  const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); p.request = { sequence: 1, through: "2024-02-01", historyThrough: "2024-01-07" };
  nextHealthSyncWindow(p, new Date("2024-02-01T04:00:00Z"));
  for (const d of syncProgressDomains(p)) { d.recentRequestSequence = 1; d.backfillNext = "2024-02-02"; }
  p.health!.backfillNext = "2024-01-01"; p.health!.activity!.backfillNext = "2024-01-01"; db.job(p);
  const files = new Map<string, string>(), staged = new Map<string, string>();
  const tools: { name: string; args: Record<string, unknown> }[] = [], requests: string[] = [];
  const faults = { detailId: "", invalidGrant: false, write: false };
  let revision = 1, commits = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input); requests.push(url);
    assert.equal(init?.redirect, "manual");
    if (url.includes("oauth-protected-resource")) return Response.json({ resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
    if (url.includes("oauth-authorization-server")) return Response.json({ issuer: origin, authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`, registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
    if (url.endsWith("/oauth2/token")) return faults.invalidGrant ? Response.json({ error: "invalid_grant" }, { status: 400 })
      : Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-renewed", token_type: "Bearer", expires_in: 3600, scope: "mcp.tools" });
    if (url === resource) {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (!init?.body) return new Response(null, { status: 405 });
      const request = JSON.parse(String(init.body));
      if (request.id === undefined) return new Response(null, { status: 202 });
      let result;
      if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "synthetic-coros", version: "1.0.0" } };
      else if (request.method === "tools/list") result = { tools: ["querySleepHrv", "querySportRecords", "getActivityDetail", "queryRecoveryStatus"].map(name => ({ name, inputSchema: { type: "object" } })) };
      else if (request.method === "tools/call") {
        const name = request.params.name, args = request.params.arguments; tools.push({ name, args });
        const from = iso(args.startDate), through = iso(args.endDate); let source: string;
        if (name === "querySleepHrv") {
          const dates: string[] = []; for (let d = from; d <= through; d = shiftDate(d, 1)) dates.push(d);
          source = `Sleep HRV — ${from} to ${through}\n========================\n\nHRV Assessment — Last ${dates.length} days\n========================\n\n`
            + dates.map(d => `${d}:\n  HRV Avg: ${40 + Math.round((Date.parse(d) - Date.parse("2024-01-01")) / 86400000) % 7} ms\n  Normal Range: 30 - 60 ms${d <= "2024-01-03" ? "\n  Baseline: 45 ms" : ""}`).join("\n")
            + `\n\nSleep HRV Time Series — Last ${dates.length} days\n========================\n\nSynthetic raw sample: hrv=999`;
        } else if (name === "querySportRecords") {
          const rows = [{ date: "2024-01-03", id: "101" }, { date: "2024-01-04", id: "102" }, { date: "2024-02-02", id: "999" }].filter(a => a.date >= from && a.date <= through);
          assert.ok(rows.length, "this integration must use a nonempty activity source");
          source = `Sport Records — ${from} to ${through} (${rows.length} records)\n========================\n\n` + rows.map((a, i) => {
            const start = Date.parse(`${a.date}T04:00:00Z`) / 1000;
            return `${i + 1}. Jump Rope — ${a.date}\n   Time Window: startTimestamp=${start} | endTimestamp=${start + 660}\n   Duration: 10:00 | Sets: 500\n   LabelId: ${a.id} | SportType: 901`;
          }).join("\n\n");
        } else if (name === "getActivityDetail") source = String(args.labelId) === faults.detailId ? "synthetic invalid detail"
          : "🚶 Jump Rope Activity Details\n========================================\n\nWorkout Time: 10:00\nTotal Reps: 500\nTraining Load: 11\nPerceived Effort: Easy";
        else { assert.equal(name, "queryRecoveryStatus"); source = "Recovery Status\n========================\n\nRecovery: 60%\nLevel: Rest recommended\nEstimated Full Recovery: 2h"; }
        result = { content: [{ type: "text", text: JSON.stringify(source) }] };
      } else return Response.json({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Synthetic method unavailable" } });
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    }
    assert.equal(new URL(url).origin, "https://api.github.com");
    const route = new URL(url).pathname;
    if (route.endsWith("/access_tokens")) return Response.json({ token: "synthetic-installation", expires_at: "2099-01-01T00:00:00Z" }, { status: 201 });
    if (route === "/repos/example-owner/private-data") return Response.json({ full_name: "example-owner/private-data", private: true, visibility: "private", default_branch: "main" });
    if (route.endsWith("/contents/workspace.json")) {
      const value = JSON.stringify({ schema_version: 1, workspace_id: "synthetic", owner_id: "test-owner", owner_login: "example-owner", timezone: "Asia/Shanghai", locale: "zh-CN" });
      return Response.json({ type: "file", path: "workspace.json", sha: sha(value), size: Buffer.byteLength(value), encoding: "base64", content: Buffer.from(value).toString("base64") });
    }
    if (route.endsWith("/git/ref/heads/main")) return Response.json({ object: { type: "commit", sha: sha(`commit-${revision}`) } });
    if (route.includes("/git/commits/") && init?.method !== "POST") return Response.json({ tree: { sha: sha(`tree-${revision}`) } });
    if (route.includes("/git/trees/") && init?.method !== "POST") return Response.json({ truncated: false, tree: [...files].map(([path, value]) => ({ path, type: "blob", sha: sha(value), size: Buffer.byteLength(value) })) });
    if (route === "/graphql" && Object.keys(JSON.parse(String(init?.body)).variables).some(key => key.startsWith("expression"))) {
      const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
      return Response.json({ data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("expression")).map(([key, expression]) => {
        const value = files.get(expression.slice(41));
        return [`blob${key.slice(10)}`, value === undefined ? null : { __typename: "Blob", oid: sha(value), byteSize: Buffer.byteLength(value), isTruncated: false, text: value }];
      })) } });
    }
    if (route === "/graphql") {
      const { variables } = JSON.parse(String(init!.body));
      return Response.json({ data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => {
        const value = [...files.values()].find(value => sha(value) === oid)!;
        return [`blob${key.slice(3)}`, { __typename: "Blob", oid, byteSize: Buffer.byteLength(value), isTruncated: false, text: value }];
      })) } });
    }
    if (route.endsWith("/git/trees") && init?.method === "POST") {
      if (faults.write) return Response.json({}, { status: 503 });
      const body = JSON.parse(String(init.body)); assert.equal(body.base_tree, sha(`tree-${revision}`));
      for (const entry of body.tree) staged.set(entry.path, entry.content); return Response.json({ sha: sha("new-tree") }, { status: 201 });
    }
    if (route.endsWith("/git/commits") && init?.method === "POST") { const body = JSON.parse(String(init.body)); assert.deepEqual(body.parents, [sha(`commit-${revision}`)]); return Response.json({ sha: sha("new-commit") }, { status: 201 }); }
    if (route.endsWith("/git/refs/heads/main") && init?.method === "PATCH") {
      assert.equal(JSON.parse(String(init.body)).force, false); for (const [path, value] of staged) files.set(path, value); staged.clear(); revision++; commits++;
      return Response.json({ object: { type: "commit", sha: sha("new-commit") } });
    }
    throw new Error("UNEXPECTED_SYNTHETIC_ENDPOINT");
  };
  return { get db() { return db; }, files, tools, requests, faults, fetcher, get commits() { return commits; },
    dependencies: corosSyncDependenciesWithFetch((input, init) => fetcher(input, { ...init, redirect: "manual" })),
    restart() { const snapshot = db.sqlite.serialize(), env = db.env; db.sqlite.close(); db = syncTestDatabase(snapshot); db.env = { ...env, DB: db.db }; } };
}
