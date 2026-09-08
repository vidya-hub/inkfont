import { uid, node, type Contour } from "./model";
import { fitContour } from "./operations";
export interface TraceInput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  threshold: number;
  tolerance: number;
  noise: number;
}
export function traceImage({
  pixels,
  width,
  height,
  threshold,
  tolerance,
  noise,
}: TraceInput): Contour[] {
  if (
    width * height > 16000000 ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height * 4
  )
    throw new Error("Image must be at most 16 megapixels.");
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const a = pixels[i * 4 + 3] / 255,
      l =
        (pixels[i * 4] * 0.2126 +
          pixels[i * 4 + 1] * 0.7152 +
          pixels[i * 4 + 2] * 0.0722) *
          a +
        255 * (1 - a);
    mask[i] = l < threshold ? 1 : 0;
  }
  type Edge = { x: number; y: number; ex: number; ey: number; used?: boolean };
  const edges: Edge[] = [],
    starts = new Map<number, number[]>(),
    key = (x: number, y: number) => y * (width + 1) + x;
  const add = (x: number, y: number, ex: number, ey: number) => {
    const k = key(x, y),
      list = starts.get(k) ?? [];
    list.push(edges.length);
    starts.set(k, list);
    edges.push({ x, y, ex, ey });
    if (edges.length > 500000)
      throw new Error(
        "Image has too much detail. Crop it or adjust threshold.",
      );
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (y === 0 || !mask[(y - 1) * width + x]) add(x, y, x + 1, y);
      if (x === width - 1 || !mask[y * width + x + 1])
        add(x + 1, y, x + 1, y + 1);
      if (y === height - 1 || !mask[(y + 1) * width + x])
        add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[y * width + x - 1]) add(x, y + 1, x, y);
    }
  const contours: Contour[] = [];
  const factor = 700 / height;
  for (const first of edges) {
    if (first.used) continue;
    let e = first;
    const points: { x: number; y: number }[] = [];
    for (let count = 0; count <= edges.length; count++) {
      e.used = true;
      points.push({ x: 60 + e.x * factor, y: 700 - e.y * factor });
      if (e.ex === first.x && e.ey === first.y) break;
      const candidates = (starts.get(key(e.ex, e.ey)) ?? [])
        .map((i) => edges[i])
        .filter((q) => !q.used);
      if (!candidates.length) break;
      const dx = e.ex - e.x,
        dy = e.ey - e.y;
      candidates.sort((a, b) => {
        const score = (q: Edge) => {
          const cross = dx * (q.ey - q.y) - dy * (q.ex - q.x),
            dot = dx * (q.ex - q.x) + dy * (q.ey - q.y);
          return cross > 0 ? 0 : dot > 0 ? 1 : cross < 0 ? 2 : 3;
        };
        return score(a) - score(b);
      });
      e = candidates[0];
    }
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area) / 2 < noise * factor * factor) continue;
    const simplified = points.filter((p, i) => {
      const a = points[(i + points.length - 1) % points.length],
        b = points[(i + 1) % points.length];
      return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x);
    });
    if (simplified.length >= 3) {
      const c = { id: uid(), closed: true, nodes: simplified.map(node) };
      contours.push(tolerance > 0 ? fitContour(c, tolerance) : c);
    }
  }
  return contours;
}
