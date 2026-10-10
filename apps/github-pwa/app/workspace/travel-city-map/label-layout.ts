type RegionAnchor = { city: string | null; x: number; y: number };
export type CityMapLabel = {
  city: string; anchorX: number; anchorY: number;
  x: number; y: number; width: number; height: number; lines: string[];
};

const WIDTH = 790;
const MAP_HEIGHT = 540;

// Use screen-sized type, including on phones. Reserve the entire name (wrapped
// only when necessary), then place each box nearest its geographic anchor.
// Extra vertical space is preferable to dropping names or shrinking the type.
export function layoutCityMapLabels(regions: readonly RegionAnchor[], renderedWidth: number) {
  const unit = WIDTH / Math.max(160, Math.min(850, renderedWidth));
  // Match the national map's 10 SVG units on desktop; retain 10px on phones.
  const fontSize = Math.max(10, 10 * unit);
  const padding = 3 * unit, gap = 4 * unit, margin = 6 * unit;
  const lineHeight = fontSize * 1.25;
  const charactersPerLine = Math.max(1, Math.floor((WIDTH * 0.36 - 2 * padding) / fontSize));
  const boxes = regions.filter((r): r is RegionAnchor & { city: string } => Boolean(r.city)).map(region => {
    const characters = Array.from(region.city);
    const lines: string[] = [];
    for (let i = 0; i < characters.length; i += charactersPerLine) lines.push(characters.slice(i, i + charactersPerLine).join(""));
    return { ...region, lines, width: Math.max(...lines.map(line => Array.from(line).length)) * fontSize + 2 * padding,
      height: lines.length * lineHeight + 2 * padding };
  }).sort((a, b) => b.height - a.height || b.width - a.width || a.y - b.y || a.x - b.x);
  let height = MAP_HEIGHT;
  for (;;) {
    const mapOffsetY = (height - MAP_HEIGHT) / 2;
    const labels: CityMapLabel[] = [];
    for (const box of boxes) {
      const anchorX = box.x, anchorY = box.y + mapOffsetY;
      const clampX = (x: number) => Math.max(margin + box.width / 2, Math.min(WIDTH - margin - box.width / 2, x));
      const clampY = (y: number) => Math.max(margin + box.height / 2, Math.min(height - margin - box.height / 2, y));
      const candidates = [{ x: clampX(anchorX), y: clampY(anchorY) }];
      const step = lineHeight / 2;
      for (let y = margin + box.height / 2; y <= height - margin - box.height / 2; y += step) {
        for (let x = margin + box.width / 2; x <= WIDTH - margin - box.width / 2; x += step) candidates.push({ x, y });
      }
      candidates.sort((a, b) => Math.hypot(a.x - anchorX, a.y - anchorY) - Math.hypot(b.x - anchorX, b.y - anchorY));
      const position = candidates.find(p => labels.every(other =>
        Math.abs(p.x - other.x) >= (box.width + other.width) / 2 + gap ||
        Math.abs(p.y - other.y) >= (box.height + other.height) / 2 + gap));
      if (!position) break;
      labels.push({ city: box.city, anchorX, anchorY, ...position, width: box.width, height: box.height, lines: box.lines });
    }
    if (labels.length === boxes.length) return { labels, height, mapOffsetY, fontSize, lineHeight };
    height += Math.max(...boxes.map(box => box.height)) + gap;
  }
}

// End the leader at the label's edge, rather than drawing through its text.
export function cityLabelLeader(label: CityMapLabel) {
  const dx = label.anchorX - label.x, dy = label.anchorY - label.y;
  const scale = Math.max(Math.abs(dx) / (label.width / 2), Math.abs(dy) / (label.height / 2));
  return scale > 1 ? { x: label.x + dx / scale, y: label.y + dy / scale } : null;
}
