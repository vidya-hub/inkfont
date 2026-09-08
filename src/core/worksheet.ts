import type { Point } from "./model";
export const sheet = {
  width: 800,
  height: 1100,
  cols: 5,
  rows: 6,
  left: 60,
  top: 100,
  cw: 136,
  ch: 148,
  markers: [
    { x: 30, y: 30 },
    { x: 770, y: 30 },
    { x: 770, y: 1070 },
    { x: 30, y: 1070 },
  ],
};
// Solve an eight-parameter projective map with partial-pivot Gaussian elimination.
export function homography(from: Point[], to: Point[]): number[] {
  if (from.length !== 4 || to.length !== 4)
    throw new Error("Choose four registration markers.");
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i],
      { x: u, y: v } = to[i];
    a.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  }
  for (let k = 0; k < 8; k++) {
    let best = k;
    for (let j = k + 1; j < 8; j++)
      if (Math.abs(a[j][k]) > Math.abs(a[best][k])) best = j;
    [a[k], a[best]] = [a[best], a[k]];
    if (Math.abs(a[k][k]) < 1e-10)
      throw new Error("Markers do not form a valid page.");
    const divisor = a[k][k];
    for (let j = k; j <= 8; j++) a[k][j] /= divisor;
    for (let i = 0; i < 8; i++)
      if (i !== k) {
        const m = a[i][k];
        for (let j = k; j <= 8; j++) a[i][j] -= m * a[k][j];
      }
  }
  return a.map((r) => r[8]);
}
export function projectPoint(h: number[], p: Point): Point {
  const d = h[6] * p.x + h[7] * p.y + 1;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / d,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / d,
  };
}
export function rectify(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  markers: Point[],
): Uint8ClampedArray {
  const h = homography(sheet.markers, markers),
    out = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const p = projectPoint(h, { x, y }),
        sx = Math.round(p.x),
        sy = Math.round(p.y),
        i = (y * sheet.width + x) * 4,
        j = (sy * width + sx) * 4;
      for (let k = 0; k < 4; k++)
        out[i + k] =
          sx < 0 || sy < 0 || sx >= width || sy >= height ? 255 : pixels[j + k];
    }
  return out;
}
export function detectMarkers(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
): Point[] {
  const seen = new Uint8Array(w * h),
    found: { x: number; y: number; area: number }[] = [],
    dark = (i: number) =>
      pixels[i * 4] < 80 &&
      pixels[i * 4 + 1] < 80 &&
      pixels[i * 4 + 2] < 80 &&
      pixels[i * 4 + 3] > 128;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !dark(i)) continue;
    const queue = [i];
    seen[i] = 1;
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q],
        x = v % w,
        y = Math.floor(v / w);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const n of [
        x > 0 ? v - 1 : -1,
        x < w - 1 ? v + 1 : -1,
        y > 0 ? v - w : -1,
        y < h - 1 ? v + w : -1,
      ])
        if (n >= 0 && !seen[n] && dark(n)) {
          seen[n] = 1;
          queue.push(n);
        }
    }
    const bw = maxX - minX + 1,
      bh = maxY - minY + 1;
    if (
      queue.length > 12 &&
      bw / bh > 0.65 &&
      bw / bh < 1.5 &&
      queue.length / (bw * bh) > 0.7
    )
      found.push({
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        area: queue.length,
      });
  }
  const result: Point[] = [];
  for (const corner of [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]) {
    const choices = found.filter(
      (p) =>
        (corner.x === 0 ? p.x < w * 0.3 : p.x > w * 0.7) &&
        (corner.y === 0 ? p.y < h * 0.3 : p.y > h * 0.7),
    );
    choices.sort(
      (a, b) =>
        Math.hypot(a.x - corner.x, a.y - corner.y) -
        Math.hypot(b.x - corner.x, b.y - corner.y),
    );
    if (!choices.length) return [];
    result.push(choices[0]);
  }
  return result;
}
