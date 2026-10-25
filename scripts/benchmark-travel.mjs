// Synthetic-only browser harness. No real authentication or remote data access.
// PLAYWRIGHT_MODULE=/tmp/travel-perf/node_modules/playwright/index.mjs \
// node scripts/benchmark-travel.mjs --out apps/github-pwa/out --result /tmp/travel-after.json
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const root = resolve(arg("--out", "apps/github-pwa/out"));
const resultPath = arg("--result", "/tmp/travel-results.json");
const repetitions = Number(arg("--runs", "5"));
const count = Number(arg("--records", "60"));
const delay = Number(arg("--delay", "100"));
const preview = process.argv.includes("--preview");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const sha = text => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
const makeFile = (path, value) => { const text = JSON.stringify(value); return { path, text, sha: sha(text), size: Buffer.byteLength(text) }; };
const descriptor = makeFile("workspace.json", { schema_version: 1, workspace_id: "synthetic", owner_id: "test_owner", owner_login: "synthetic", locale: "zh-CN", timezone: "Asia/Shanghai" });
const files = new Map();
for (let i = 0; i < count; i++) {
  const id = `travel_${String(i).padStart(4, "0")}`;
  files.set(`data/travel-visits/${id}.json`, makeFile(`data/travel-visits/${id}.json`, {
    schema_version: 1, entity_type: "travel_visit", id, owner_id: "test_owner", version: 1,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", deleted_at: null,
    data: { travel_visit_version: 2, province_id: "330000", city: "杭州市", start_date: "2026-10-01", end_date: "2026-10-02", notes: `合成旅行 ${i}` },
  }));
}
let failure = "", graphQL = !process.argv.includes("--rest-only"), unknown = [], noticesDelay = 0, mapFailure = false;
const json = (res, data, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/__fixture/")) {
    const path = url.pathname.slice("/__fixture".length);
    await sleep(delay);
    if (path === "/auth/status") return json(res, { configured: true, authenticated: true, login: "synthetic" });
    if (path === "/auth/token") return json(res, { accessToken: "synthetic-never-valid" });
    if (path === "/graphql") {
      if (!graphQL) return json(res, {}, 403);
      if (failure === "rate") return json(res, { errors: [{ type: "RATE_LIMITED", message: "synthetic rate limit" }] });
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const { variables } = JSON.parse(Buffer.concat(chunks).toString());
      const repository = {};
      for (const [key, oid] of Object.entries(variables).filter(([key]) => key.startsWith("oid"))) {
        const file = [...files.values()].find(file => file.sha === oid);
        repository[`blob${key.slice(3)}`] = file ? { __typename: "Blob", oid, byteSize: file.size, isTruncated: false, text: failure === "corrupt" ? "{}" : file.text } : null;
      }
      return json(res, { data: { repository } });
    }
    if (path === "/repos/lubannn/personal-workspace-data") return json(res, { full_name: "lubannn/personal-workspace-data", private: true, visibility: "private", default_branch: "main" });
    const prefix = "/repos/lubannn/personal-workspace-data/contents/";
    if (path.startsWith(prefix)) {
      const target = decodeURIComponent(path.slice(prefix.length));
      if (target === "workspace.json") return json(res, { type: "file", ...descriptor, encoding: "base64", content: Buffer.from(descriptor.text).toString("base64") });
      if (target === "data/notices") { await sleep(noticesDelay); return json(res, []); }
      if (target === "data/travel-visits") {
        if (failure === "auth") return json(res, {}, 401);
        return json(res, [...files.values()].map(f => ({ type: "file", name: f.path.split("/").at(-1), path: f.path, sha: f.sha, size: f.size })));
      }
      const file = files.get(target);
      if (req.method === "PUT") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (failure === "conflict" || (file && file.sha !== body.sha)) return json(res, {}, 409);
        const stored = makeFile(target, JSON.parse(Buffer.from(body.content, "base64").toString())); files.set(target, stored);
        return json(res, { content: { path: target, sha: stored.sha }, commit: { sha: "a".repeat(40) } });
      }
      if (file) return json(res, { type: "file", path: target, sha: file.sha, size: file.size, encoding: "base64", content: Buffer.from(file.text).toString("base64") });
    }
    const blob = path.match(/\/git\/blobs\/([a-f0-9]{40})$/);
    if (blob) {
      const file = [...files.values()].find(file => file.sha === blob[1]);
      if (file) return json(res, { sha: file.sha, size: file.size, encoding: "base64", content: Buffer.from(file.text).toString("base64") });
    }
    unknown.push(path); return json(res, {}, 404);
  }
  if (url.pathname === "/sw.js") { res.writeHead(404); res.end(); return; }
  if (mapFailure && /\/travel-city-maps\/\d+\.json$/.test(url.pathname)) { res.writeHead(503); res.end(); return; }
  try {
    let target = resolve(root, `.${url.pathname}`);
    if (!target.startsWith(root + "/") && target !== root) throw Error("Invalid path");
    if (url.pathname.endsWith("/")) target += "/index.html";
    let data = await readFile(target);
    if (preview && extname(target) === ".html") data = Buffer.from(data.toString().replace("<head>", `<head><script>(${installFixture.toString()})();if(!location.hash)location.hash='#workspace-panel-travel';</script>`));
    res.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" })[extname(target)] ?? "application/octet-stream", "cache-control": url.pathname.includes("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache" }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(preview ? Number(arg("--port", "4173")) : 0, preview ? "0.0.0.0" : "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (preview) {
  console.log(`Synthetic-only preview: ${origin}/#workspace-panel-travel (no real GitHub requests or credentials)`);
  await new Promise(() => {});
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>;127.0.0.1"] });
function installFixture() {
    const nativeFetch = globalThis.fetch;
    window.__fetches = []; window.__longTasks = [];
    const cookieGetter = Object.getOwnPropertyDescriptor(Document.prototype, "cookie").get;
    Object.defineProperty(document, "cookie", { get: () => `${cookieGetter.call(document)}; __Host-pw_csrf=synthetic-csrf` });
    globalThis.fetch = async (input, init) => {
      let url = String(input);
      if (url.startsWith("https://api.github.com/")) url = `/__fixture${new URL(url).pathname}${new URL(url).search}`;
      else if (url.startsWith("/auth/")) url = `/__fixture${url}`;
      else if (!url.startsWith("/") && !url.startsWith(location.origin)) throw Error("External fetch blocked by synthetic harness");
      const log = { url, method: init?.method ?? "GET", start: performance.now() }; window.__fetches.push(log);
      try { const response = await nativeFetch(url, init); log.end = performance.now(); log.status = response.status; return response; }
      catch (error) { log.end = performance.now(); throw error; }
    };
    new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask", buffered: true });
}
async function newPage(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, serviceWorkers: "block" });
  await context.addInitScript(installFixture);
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { context, page, errors };
}
async function ready(page, n = count) {
  await page.waitForFunction(n => document.querySelectorAll("#workspace-panel-travel .travel-visit-list .travel-records > li").length === n && document.querySelector("#workspace-panel-travel .primary-button")?.disabled === false, n);
  return page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())))));
}
async function snapshot(page, start, end) {
  return page.evaluate(({ start, end }) => {
    const requests = window.__fetches.filter(r => r.start >= start && r.start < end);
    const reads = requests.filter(r => /travel-visits|graphql|git\/blobs/.test(r.url));
    const directory = reads.find(r => /\/contents\/data\/travel-visits\?/.test(r.url));
    const last = Math.max(directory?.end ?? start, ...reads.map(r => r.end ?? start));
    const resources = performance.getEntriesByType("resource").filter(r => r.startTime >= start && r.startTime < end && !r.name.includes("/__fixture/"));
    return { totalMs: end - start, directoryMs: directory ? directory.end - directory.start : 0, bodyWindowMs: last - (directory?.end ?? last), afterDataMs: end - last, requests: reads.length, requestKinds: reads.reduce((counts, r) => { const kind = r.url.includes("graphql") ? "graphql" : r.url.includes("git/blobs") ? "blob" : r.url.includes(".json") ? "file" : "directory"; counts[kind] = (counts[kind] ?? 0) + 1; return counts; }, {}), otherDataRequests: requests.filter(r => /\/contents\/data\//.test(r.url) && !r.url.includes("travel-visits")).map(r => r.url), assetTransferBytes: resources.reduce((n, r) => n + r.transferSize, 0), assetDecodedBytes: resources.reduce((n, r) => n + r.decodedBodySize, 0), longTaskMs: window.__longTasks.filter(r => r.start >= start && r.start < end).reduce((n, r) => n + r.duration, 0), requestsDetail: reads };
  }, { start, end });
}
async function verify() {
  assert.ok(count > 0, "--verify requires at least one record");
  const report = { maps: [], checks: [] };
  const screenshots = resolve(arg("--screenshots", "/tmp/travel-preview")); await mkdir(screenshots, { recursive: true });
  for (const width of [1440, 390, 320]) {
    const { page, context, errors } = await newPage(width);
    await page.goto(`${origin}/#workspace-panel-travel`); await ready(page);
    assert.equal(await page.locator(".travel-national-map").isVisible(), true);
    assert.equal(await page.locator(".travel-national-map path[role=button]").count(), 34);
    await page.screenshot({ path: `${screenshots}/national-${width}.png`, fullPage: true });
    for (const id of ["440000", "650000", "520000", "710000"]) {
      const map = JSON.parse(await readFile(`${root}/travel-city-maps/${id}.json`, "utf8"));
      const start = await page.evaluate(() => performance.now());
      await page.locator(".travel-provinces button").nth(["110000","120000","130000","140000","150000","210000","220000","230000","310000","320000","330000","340000","350000","360000","370000","410000","420000","430000","440000","450000","460000","500000","510000","520000","530000","540000","610000","620000","630000","640000","650000","710000","810000","820000"].indexOf(id)).click();
      await page.locator(".travel-city-map").waitFor();
      const end = await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())))));
      const expected = map.regions.filter(r => r.city).map(r => r.city).sort();
      const labels = await page.locator(".travel-city-label").evaluateAll(nodes => nodes.map(n => n.querySelector("text").textContent).sort());
      assert.deepEqual(labels, expected);
      const layout = await page.locator(".travel-city-map").evaluate(svg => {
        const bounds = svg.getBoundingClientRect();
        const labels = [...svg.querySelectorAll(".travel-city-label rect")].map(n => n.getBoundingClientRect());
        return { overlap: labels.some((a, i) => labels.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.1)), clipped: labels.some(a => a.left < bounds.left - 1 || a.right > bounds.right + 1 || a.top < bounds.top - 1 || a.bottom > bounds.bottom + 1), strokes: [...svg.querySelectorAll(".travel-city-label text")].map(n => getComputedStyle(n).stroke), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.overlap, false); assert.equal(layout.clipped, false); assert.equal(layout.overflow, false); assert.ok(layout.strokes.every(s => s === "none"));
      report.maps.push({ width, id, labels: labels.length, totalMs: end - start, ...layout });
      if (id === "650000" || (id === "440000" && width === 390)) await page.screenshot({ path: `${screenshots}/province-${id}-${width}.png`, fullPage: true });
      // Same-tab click must return to the national map, including at narrow widths.
      await page.getByRole("tab", { name: "旅行", exact: true }).click();
      assert.equal(await page.locator(".travel-national-map").isVisible(), true);
      assert.equal(await page.locator(".travel-city-map").count(), 0);
    }
    assert.deepEqual(errors, []); await context.close();
  }
  report.checks.push("34 national regions; complete non-overlapping city labels, leaders and no white stroke at 1440/390/320; same-tab national reset");
  const { page, context, errors } = await newPage();
  await page.goto(`${origin}/#workspace-panel-travel`); await ready(page);
  const records = page.locator(".travel-visit-list .travel-records > li");
  await records.first().getByRole("button", { name: /^编辑/ }).click();
  const notes = page.getByRole("textbox", { name: "备注（可选）", exact: true });
  await notes.fill("合成编辑\n保持表单");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("tab", { name: "通告", exact: true }).click();
    await page.getByRole("tab", { name: "旅行", exact: true }).click();
    assert.equal(await notes.inputValue(), "合成编辑\n保持表单");
    assert.equal(await page.locator(".travel-national-map").isVisible(), true);
  }
  assert.equal(await page.evaluate(() => window.__fetches.filter(r => /\/contents\/data\/travel-visits\?/.test(r.url)).length), 1);
  failure = "conflict";
  await page.getByRole("button", { name: "保存到访", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "另一台设备" }).waitFor();
  assert.equal(await notes.inputValue(), "合成编辑\n保持表单");
  failure = "";
  await page.getByRole("button", { name: "刷新记录", exact: true }).click(); await ready(page);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await records.first().getByRole("button", { name: /^编辑/ }).click(); await notes.fill("合成保存成功");
  await page.getByRole("button", { name: "保存到访", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".travel-form"));
  assert.equal(await records.first().locator(".travel-notes").textContent(), "合成保存成功");
  await records.first().getByRole("button", { name: /^删除/ }).click(); await ready(page, count - 1);
  await page.locator(".travel-trash summary").click(); await page.getByRole("button", { name: "恢复", exact: true }).click(); await ready(page);
  report.checks.push("repeat navigation has no data re-read and preserves draft; edit/save, conflict draft recovery, soft delete/restore");
  failure = "auth";
  await page.getByRole("button", { name: "刷新记录", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "令牌无效" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "新增到访", exact: true }).isDisabled(), true);
  failure = ""; await page.getByRole("button", { name: "刷新记录", exact: true }).click(); await ready(page);
  const [path, original] = [...files][0]; const updated = JSON.parse(original.text); updated.version++; updated.data.notes = "合成另一设备更新";
  files.set(path, makeFile(path, updated));
  await page.getByRole("button", { name: "刷新记录", exact: true }).click(); await ready(page);
  await page.getByText("合成另一设备更新", { exact: true }).waitFor();
  files.delete(path); await page.getByRole("button", { name: "刷新记录", exact: true }).click(); await ready(page, count - 1);
  files.set(path, original);
  report.checks.push("refresh revalidates authorization, recovers, detects external updates and removals without stale resurrection");
  mapFailure = true;
  await page.locator(".travel-provinces button").filter({ hasText: "浙江" }).click();
  await page.getByRole("status").filter({ hasText: "城市边界暂时无法加载" }).waitFor();
  assert.equal(await page.locator(".travel-city-list button").count(), 11);
  mapFailure = false;
  await page.getByRole("button", { name: "返回全国", exact: true }).click();
  await page.locator(".travel-provinces button").filter({ hasText: "浙江" }).click(); await page.locator(".travel-city-map").waitFor();
  await page.getByLabel("查看省份", { exact: true }).selectOption("440000");
  await page.getByLabel("查看省份", { exact: true }).selectOption("650000");
  await page.getByRole("group", { name: "新疆维吾尔自治区城市到访地图", exact: true }).waitFor();
  report.checks.push("map failure retains full city list and recovers; rapid province changes end at the requested province");
  assert.deepEqual(errors, []); await context.close();
  noticesDelay = 1600;
  const overlap = await newPage(); await overlap.page.goto(`${origin}/#workspace-panel-notices`);
  await overlap.page.waitForFunction(() => window.__fetches.some(r => r.url.includes("/contents/data/notices") && !r.end));
  await overlap.page.getByRole("tab", { name: "旅行", exact: true }).click(); await ready(overlap.page);
  const concurrent = await overlap.page.evaluate(() => ({ travel: window.__fetches.find(r => /\/contents\/data\/travel-visits\?/.test(r.url)), notices: window.__fetches.find(r => r.url.includes("/contents/data/notices")) }));
  assert.ok(concurrent.travel.start < (concurrent.notices.end ?? Infinity));
  assert.deepEqual(overlap.errors, []); await overlap.context.close(); noticesDelay = 0;
  report.checks.push("a delayed unrelated notice read does not serialize travel; no journal or health requests");
  for (const mode of ["rate", "corrupt"]) {
    failure = mode; const invalid = await newPage(); await invalid.page.goto(`${origin}/#workspace-panel-travel`);
    await invalid.page.locator("#workspace-panel-travel [role=alert]").waitFor();
    assert.equal(await invalid.page.getByRole("button", { name: "新增到访", exact: true }).isDisabled(), true);
    assert.equal(await invalid.page.locator(".travel-visit-list .travel-records > li").count(), 0);
    failure = ""; await invalid.page.getByRole("button", { name: "刷新记录", exact: true }).click(); await ready(invalid.page);
    assert.deepEqual(invalid.errors, []); await invalid.context.close();
  }
  report.checks.push("rate limit and corrupt/incomplete batch block writes and partial snapshots, then recover on explicit retry");
  report.screenshots = screenshots;
  return report;
}
const results = [];
try {
  for (let run = 0; run < repetitions; run++) {
    const { page, context, errors } = await newPage();
    await page.goto(`${origin}/#workspace-panel-travel`);
    const cold = await snapshot(page, 0, await ready(page));
    await page.reload();
    const reload = await snapshot(page, 0, await ready(page));
    await page.getByRole("tab", { name: "通告", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#workspace-panel-notices").hidden);
    const start = await page.evaluate(() => performance.now());
    await page.getByRole("tab", { name: "旅行", exact: true }).click();
    const repeat = await snapshot(page, start, await ready(page));
    const refreshStart = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await page.waitForFunction(start => window.__fetches.some(r => r.start >= start && r.url.includes("travel-visits")), refreshStart);
    const refresh = await snapshot(page, refreshStart, await ready(page));
    assert.deepEqual(errors, []); assert.equal(repeat.requests, 0);
    results.push({ run, cold, reload, repeat, refresh });
    console.log(JSON.stringify({ run, cold: cold.totalMs, reload: reload.totalMs, repeat: repeat.totalMs, refresh: refresh.totalMs, coldRequests: cold.requests, refreshRequests: refresh.requests }));
    await context.close();
    const shell = await newPage(); await shell.page.goto(`${origin}/#workspace-panel-notices`);
    await shell.page.waitForFunction(() => document.querySelector("#workspace-panel-notices button")?.disabled === false && window.__fetches.some(r => r.url.includes("/contents/data/notices") && r.end));
    const firstStart = await shell.page.evaluate(() => performance.now());
    await shell.page.getByRole("tab", { name: "旅行", exact: true }).click();
    results.at(-1).firstClick = await snapshot(shell.page, firstStart, await ready(shell.page));
    assert.deepEqual(shell.errors, []); await shell.context.close();
  }
  const verification = process.argv.includes("--verify") ? await verify() : undefined;
  assert.deepEqual(unknown, []);
  const output = { root, chromium: browser.version(), cpuSlowdown: 4, graphQL, count, apiDelayMs: delay, repetitions, results, verification };
  await writeFile(resultPath, JSON.stringify(output, null, 2));
  console.log(`Saved ${resultPath}`);
} finally { await browser.close(); server.close(); }
