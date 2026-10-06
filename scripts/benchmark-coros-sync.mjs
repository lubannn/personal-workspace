import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

// Run: node scripts/benchmark-coros-sync.mjs
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const viteRequire = createRequire(createRequire(require.resolve("vitest/package.json")).resolve("vite"));
const { build } = viteRequire("esbuild");
const output = path.join(await mkdtemp(path.join(tmpdir(), "coros-sync-cpu-")), "benchmark.mjs");
await build({ entryPoints: [path.join(root, "scripts/coros-sync-cpu-benchmark.ts")], bundle: true, platform: "node", format: "esm", outfile: output,
  banner: { js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(path.join(root, "package.json"))});` },
  plugins: [{ name: "synthetic-sqlite", setup(builder) {
    builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve("better-sqlite3"), external: true }));
    builder.onLoad({ filter: /coros-sync-test-helpers\.ts$/ }, async args => ({ loader: "ts", contents: (await readFile(args.path, "utf8")).replaceAll("import.meta.url", JSON.stringify(new URL(`file://${args.path}`).href)) }));
  } }] });
const result = spawnSync(process.execPath, [output], { stdio: "inherit", cwd: root });
process.exitCode = result.status ?? 1;
