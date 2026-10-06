// Decode Apache ECharts 4.9.0 UTF8 GeoJSON and project its real boundaries.
// No topology is invented; simplification removes points within 0.25 SVG units.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../apps/github-pwa/app/workspace/travel-map/', import.meta.url);
const raw = readFileSync(new URL('china.source.json', root));
const source = JSON.parse(raw);
function decode(encoded, offset) {
  let [x, y] = offset;
  const points = [];
  for (let i = 0; i < encoded.length; i += 2) {
    let dx = encoded.charCodeAt(i) - 64, dy = encoded.charCodeAt(i + 1) - 64;
    dx = (dx >> 1) ^ -(dx & 1); dy = (dy >> 1) ^ -(dy & 1);
    x += dx; y += dy;
    points.push([(x / 1024 - 73) * 12 + 12, (54 - y / 1024) * 14 + 12]);
  }
  return points;
}
function simplify(points) {
  if (points.length <= 2) return points;
  const first = points[0], last = points.at(-1);
  const dx = last[0] - first[0], dy = last[1] - first[1], length = dx * dx + dy * dy;
  let max = 0.25 ** 2, index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = length ? Math.max(0, Math.min(1, ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / length)) : 0;
    const distance = (p[0] - first[0] - t * dx) ** 2 + (p[1] - first[1] - t * dy) ** 2;
    if (distance > max) { max = distance; index = i; }
  }
  return index < 0 ? [first, last] : [...simplify(points.slice(0, index + 1)).slice(0, -1), ...simplify(points.slice(index))];
}
const regions = source.features.filter(f => /^\d{6}$/.test(f.id)).map(f => {
  const g = f.geometry;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const offsets = g.type === 'Polygon' ? [g.encodeOffsets] : g.encodeOffsets;
  const path = polygons.flatMap((rings, p) => rings.map((ring, r) => simplify(decode(ring, offsets[p][r]))
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + 'Z')).join('');
  return { id: f.id, name: f.properties.name, x: Number(((f.properties.cp[0] - 73) * 12 + 12).toFixed(1)), y: Number(((54 - f.properties.cp[1]) * 14 + 12).toFixed(1)), path };
});
if (regions.length !== 34 || new Set(regions.map(r => r.id)).size !== 34) throw Error('Expected 34 regions');
writeFileSync(new URL('provinces.json', root), JSON.stringify(regions) + '\n');
console.log(`34 regions; source SHA-256 ${createHash('sha256').update(raw).digest('hex')}`);
