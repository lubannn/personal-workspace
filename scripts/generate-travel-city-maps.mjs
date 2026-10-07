// Derive local SVG city boundaries from Apache ECharts 4.9.0 (Apache-2.0).
// Preserve every polygon/ring and unresolved source feature; never invent geometry.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const sourceRoot = new URL("../apps/github-pwa/app/workspace/travel-city-map/", import.meta.url);
const nationalRoot = new URL("../apps/github-pwa/app/workspace/travel-map/", import.meta.url);
const outputRoot = new URL("../apps/github-pwa/public/travel-city-maps/", import.meta.url);
mkdirSync(outputRoot, { recursive: true });
const read = url => JSON.parse(readFileSync(url, "utf8"));
const cities = read(new URL("../src/lib/github-data/travel-city-data/cities.json", import.meta.url));
const sources = read(new URL("sources.json", sourceRoot));
const whole = new Set(["110000", "120000", "310000", "500000", "810000", "820000"]);
// Reviewed source-name -> catalog-name equivalence only, not user-input aliases.
const taiwanNames = {
  "台北市": "臺北市", "台中市": "臺中市", "台南市": "臺南市", "台东县": "臺東縣",
  "基隆市": "基隆市", "新北市": "新北市", "桃园市": "桃園市", "新竹市": "新竹市",
  "新竹县": "新竹縣", "苗栗县": "苗栗縣", "彰化县": "彰化縣", "南投县": "南投縣",
  "云林县": "雲林縣", "嘉义市": "嘉義市", "嘉义县": "嘉義縣", "高雄市": "高雄市",
  "屏东县": "屏東縣", "宜兰县": "宜蘭縣", "花莲县": "花蓮縣", "澎湖县": "澎湖縣",
  "金门县": "金門縣", "连江县": "連江縣",
};
function decode(encoded, offset) {
  if (Array.isArray(encoded)) return encoded;
  let [x, y] = offset;
  const points = [];
  for (let i = 0; i < encoded.length; i += 2) {
    let dx = encoded.charCodeAt(i) - 64, dy = encoded.charCodeAt(i + 1) - 64;
    dx = (dx >> 1) ^ -(dx & 1); dy = (dy >> 1) ^ -(dy & 1);
    x += dx; y += dy; points.push([x / 1024, y / 1024]);
  }
  return points;
}
function rings(feature) {
  const g = feature.geometry;
  if (!["Polygon", "MultiPolygon"].includes(g.type)) throw Error("Unsupported geometry");
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const offsets = g.type === "Polygon" ? [g.encodeOffsets] : g.encodeOffsets;
  return polygons.flatMap((polygon, p) => polygon.map((ring, r) => decode(ring, offsets?.[p]?.[r])));
}
function simplify(points) {
  if (points.length <= 2) return points;
  const first = points[0], last = points.at(-1);
  const dx = last[0] - first[0], dy = last[1] - first[1], length = dx * dx + dy * dy;
  let max = 0.35 ** 2, index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = length ? Math.max(0, Math.min(1, ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / length)) : 0;
    const distance = (p[0] - first[0] - t * dx) ** 2 + (p[1] - first[1] - t * dy) ** 2;
    if (distance > max) { max = distance; index = i; }
  }
  return index < 0 ? [first, last] : [...simplify(points.slice(0, index + 1)).slice(0, -1), ...simplify(points.slice(index))];
}
const manifest = {};
for (const [id, options] of Object.entries(cities)) {
  const sourcePath = whole.has(id) ? new URL("china.source.json", nationalRoot) : new URL(`sources/${sources[id]}.json`, sourceRoot);
  const raw = readFileSync(sourcePath), data = JSON.parse(raw);
  const features = whole.has(id) ? data.features.filter(f => f.id === id) : data.features;
  const emptyFeatures = [];
  const shapes = features.map(f => ({ f, rings: rings(f) })).filter(shape => {
    if (shape.rings.length && shape.rings.every(ring => ring.length >= 3)) return true;
    // Upstream Tibet has an empty Shannan placeholder plus its actual polygon.
    if (id !== "540000" || shape.f.properties.name !== "山南市" || shape.rings.length) throw Error(`Empty source geometry ${id}`);
    emptyFeatures.push(shape.f.properties.name); return false;
  });
  const points = shapes.flatMap(s => s.rings.flat());
  if (!points.length || !points.every(p => p.length === 2 && p.every(Number.isFinite))) throw Error(`Invalid geometry ${id}`);
  const xmin = Math.min(...points.map(p => p[0])), xmax = Math.max(...points.map(p => p[0]));
  const ymin = Math.min(...points.map(p => p[1])), ymax = Math.max(...points.map(p => p[1]));
  const longitudeScale = Math.cos((ymin + ymax) / 2 * Math.PI / 180);
  const width = (xmax - xmin) * longitudeScale, height = ymax - ymin;
  const scale = Math.min(760 / width, 510 / height);
  const project = p => [15 + (760 - width * scale) / 2 + (p[0] - xmin) * longitudeScale * scale, 15 + (510 - height * scale) / 2 + (ymax - p[1]) * scale];
  const matched = new Set();
  const regions = shapes.map(({ f, rings }) => {
    const name = f.properties.name;
    const city = whole.has(id) ? options[0] : id === "710000" ? taiwanNames[name] ?? null : options.includes(name) ? name : null;
    if (city && (!options.includes(city) || matched.has(city))) throw Error(`Duplicate/invalid city ${city}`);
    if (city) matched.add(city);
    const path = rings.map(ring => {
      const projected = ring.map(project), simple = simplify(projected);
      const points = simple.length >= 4 ? simple : projected;
      return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
    }).join("");
    const [x, y] = project(f.properties.cp ?? rings[0][0]);
    return { sourceName: name, city, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), path };
  });
  const map = { version: 1, province_id: id, regions, missing: options.filter(city => !matched.has(city)) };
  const text = JSON.stringify(map) + "\n";
  writeFileSync(new URL(`${id}.json`, outputRoot), text);
  manifest[id] = { source: whole.has(id) ? "map/json/china.json" : `map/json/province/${sources[id]}.json`, source_sha256: createHash("sha256").update(raw).digest("hex"), output_sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text), catalog_count: options.length, mapped_count: matched.size, missing: map.missing, unmatched_source: regions.filter(r => !r.city).map(r => r.sourceName), empty_source_features: emptyFeatures };
}
if (Object.keys(manifest).length !== 34 || Object.values(cities).flat().length !== 393) throw Error("Unexpected catalog scope");
writeFileSync(new URL("manifest.json", sourceRoot), JSON.stringify(manifest, null, 2) + "\n");
// Make attribution/license readable alongside the lazily fetched public maps.
for (const name of ["LICENSE", "NOTICE"]) writeFileSync(new URL(name, outputRoot), readFileSync(new URL(name, nationalRoot)));
console.log(JSON.stringify({ provinces: 34, cities: 393, mapped: Object.values(manifest).reduce((sum, p) => sum + p.mapped_count, 0), bytes: Object.values(manifest).reduce((sum, p) => sum + p.bytes, 0), maximumProvinceBytes: Math.max(...Object.values(manifest).map(p => p.bytes)) }));
