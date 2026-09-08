import {
  uid,
  node,
  type Point,
  type Node,
  type Contour,
  type Matrix,
  type FontProject,
  type PathObject,
} from "./model";
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const mapPoint = (p: Point, m: Matrix): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function transform(
  c: Contour,
  m: Matrix,
  selected?: Set<string>,
): Contour {
  return {
    ...c,
    nodes: c.nodes.map((n) =>
      selected && !selected.has(n.id)
        ? n
        : {
            ...n,
            ...mapPoint(n, m),
            in: n.in && mapPoint(n.in, m),
            out: n.out && mapPoint(n.out, m),
          },
    ),
  };
}
export function around(
  p: Point,
  angle = 0,
  sx = 1,
  sy = sx,
  dx = 0,
  dy = 0,
): Matrix {
  const r = (angle * Math.PI) / 180,
    a = Math.cos(r) * sx,
    b = Math.sin(r) * sx,
    c = -Math.sin(r) * sy,
    d = Math.cos(r) * sy;
  return [
    a,
    b,
    c,
    d,
    p.x - a * p.x - c * p.y + dx,
    p.y - b * p.x - d * p.y + dy,
  ];
}
export function controls(a: Node, b: Node): [Point, Point, Point, Point] {
  return [a, a.out ?? lerp(a, b, 1 / 3), b.in ?? lerp(a, b, 2 / 3), b];
}
export function at(a: Node, b: Node, t: number): Point {
  const [p, c, d, q] = controls(a, b),
    u = 1 - t;
  return {
    x:
      u * u * u * p.x +
      3 * u * u * t * c.x +
      3 * u * t * t * d.x +
      t * t * t * q.x,
    y:
      u * u * u * p.y +
      3 * u * u * t * c.y +
      3 * u * t * t * d.y +
      t * t * t * q.y,
  };
}
export function segments(c: Contour): [Node, Node, number][] {
  return c.nodes
    .slice(0, c.closed ? undefined : -1)
    .map((n, i) => [n, c.nodes[(i + 1) % c.nodes.length], i]);
}
export function split(c: Contour, i: number, t = 0.5): Contour {
  const ns = c.nodes.map((n) => ({ ...n })),
    a = ns[i],
    b = ns[(i + 1) % ns.length],
    [p, q, r, s] = controls(a, b),
    pq = lerp(p, q, t),
    qr = lerp(q, r, t),
    rs = lerp(r, s, t),
    u = lerp(pq, qr, t),
    v = lerp(qr, rs, t),
    n = node(lerp(u, v, t));
  if (a.out || b.in) {
    a.out = pq;
    b.in = rs;
    n.in = u;
    n.out = v;
    n.mode = "smooth";
  }
  ns.splice(i + 1, 0, n);
  return { ...c, nodes: ns };
}
export function bend(c: Contour, i: number, t: number, delta: Point): Contour {
  const ns = c.nodes.map((n) => ({ ...n })),
    a = ns[i],
    b = ns[(i + 1) % ns.length],
    [, p, q] = controls(a, b),
    u = 3 * (1 - t) ** 2 * t,
    v = 3 * (1 - t) * t * t,
    k = u * u + v * v;
  if (k < 1e-5) return c;
  a.out = { x: p.x + (delta.x * u) / k, y: p.y + (delta.y * u) / k };
  b.in = { x: q.x + (delta.x * v) / k, y: q.y + (delta.y * v) / k };
  for (const [n, side] of [
    [a, "out"],
    [b, "in"],
  ] as const) {
    const other = side === "in" ? "out" : "in",
      h = n[side]!,
      o = n[other];
    if (n.mode !== "corner" && o) {
      const len = n.mode === "symmetric" ? distance(n, h) : distance(n, o),
        d = distance(n, h) || 1;
      n[other] = {
        x: n.x - ((h.x - n.x) * len) / d,
        y: n.y - ((h.y - n.y) * len) / d,
      };
    }
  }
  return { ...c, nodes: ns };
}
export function moveHandle(
  n: Node,
  side: "in" | "out",
  p: Point,
  breakConstraint = false,
): Node {
  const out = { ...n, [side]: p },
    other = side === "in" ? "out" : "in";
  if (breakConstraint) return { ...out, mode: "corner" };
  if (n.mode !== "corner") {
    const len =
        n.mode === "symmetric" ? distance(n, p) : distance(n, n[other] ?? n),
      d = distance(n, p) || 1;
    out[other] = {
      x: n.x - ((p.x - n.x) * len) / d,
      y: n.y - ((p.y - n.y) * len) / d,
    };
  }
  return out;
}
export function reverse(c: Contour): Contour {
  return {
    ...c,
    nodes: [...c.nodes].reverse().map((n) => ({ ...n, in: n.out, out: n.in })),
  };
}
function flat(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tol: number,
  out: Point[],
  depth = 0,
) {
  const len = distance(a, d),
    cross = (p: Point) =>
      len
        ? Math.abs((d.x - a.x) * (a.y - p.y) - (a.x - p.x) * (d.y - a.y)) / len
        : distance(p, a);
  if (
    depth >= 18 ||
    (Math.max(cross(b), cross(c)) <= tol &&
      distance(a, b) + distance(b, c) + distance(c, d) - len <= tol * 2)
  ) {
    out.push(d);
    return;
  }
  const ab = lerp(a, b, 0.5),
    bc = lerp(b, c, 0.5),
    cd = lerp(c, d, 0.5),
    u = lerp(ab, bc, 0.5),
    v = lerp(bc, cd, 0.5),
    m = lerp(u, v, 0.5);
  flat(a, ab, u, m, tol, out, depth + 1);
  flat(m, v, cd, d, tol, out, depth + 1);
}
const flats = new WeakMap<Contour, Point[]>();
export function flatten(c: Contour, tol = 0.25): Point[] {
  if (tol === 0.25 && flats.has(c)) return flats.get(c)!;
  const out: Point[] = c.nodes.length ? [c.nodes[0]] : [];
  for (const [a, b] of segments(c)) flat(...controls(a, b), tol, out);
  if (tol === 0.25) flats.set(c, out);
  return out;
}
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export function bounds(cs: Contour[]): Bounds | null {
  const pts: Point[] = [];
  for (const c of cs) {
    pts.push(...c.nodes);
    for (const [a, b] of segments(c)) {
      const [p, q, r, s] = controls(a, b);
      for (const key of ["x", "y"] as const) {
        const A = -p[key] + 3 * q[key] - 3 * r[key] + s[key],
          B = 2 * (p[key] - 2 * q[key] + r[key]),
          C = q[key] - p[key],
          D = B * B - 4 * A * C;
        const roots =
          Math.abs(A) < 1e-10
            ? Math.abs(B) > 1e-10
              ? [-C / B]
              : []
            : D >= 0
              ? [(-B + Math.sqrt(D)) / (2 * A), (-B - Math.sqrt(D)) / (2 * A)]
              : [];
        for (const t of roots) if (t > 0 && t < 1) pts.push(at(a, b, t));
      }
    }
  }
  if (!pts.length) return null;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}
export function nearest(c: Contour, p: Point) {
  let best = { distance: Infinity, i: 0, t: 0 };
  for (const [a, b, i] of segments(c)) {
    let t = 0,
      d = Infinity;
    for (let k = 0; k <= 32; k++) {
      const dd = distance(at(a, b, k / 32), p);
      if (dd < d) {
        d = dd;
        t = k / 32;
      }
    }
    let lo = Math.max(0, t - 1 / 32),
      hi = Math.min(1, t + 1 / 32);
    for (let k = 0; k < 15; k++) {
      const u = lo + (hi - lo) / 3,
        v = hi - (hi - lo) / 3;
      if (distance(at(a, b, u), p) < distance(at(a, b, v), p)) hi = v;
      else lo = u;
    }
    t = (lo + hi) / 2;
    d = distance(at(a, b, t), p);
    if (d < best.distance) best = { distance: d, i, t };
  }
  return best;
}
export function rectangle(a: Point, b: Point): Contour {
  return {
    id: uid(),
    closed: true,
    nodes: [a, { x: a.x, y: b.y }, b, { x: b.x, y: a.y }].map(node),
  };
}
export function ellipse(a: Point, b: Point): Contour {
  const cx = (a.x + b.x) / 2,
    cy = (a.y + b.y) / 2,
    rx = Math.abs(a.x - b.x) / 2,
    ry = Math.abs(a.y - b.y) / 2,
    k = 0.5522847498307936;
  return {
    id: uid(),
    closed: true,
    nodes: [
      {
        x: cx + rx,
        y: cy,
        in: { x: cx + rx, y: cy + ry * k },
        out: { x: cx + rx, y: cy - ry * k },
      },
      {
        x: cx,
        y: cy - ry,
        in: { x: cx + rx * k, y: cy - ry },
        out: { x: cx - rx * k, y: cy - ry },
      },
      {
        x: cx - rx,
        y: cy,
        in: { x: cx - rx, y: cy - ry * k },
        out: { x: cx - rx, y: cy + ry * k },
      },
      {
        x: cx,
        y: cy + ry,
        in: { x: cx - rx * k, y: cy + ry },
        out: { x: cx + rx * k, y: cy + ry },
      },
    ].map((p) => ({ ...node(p), ...p, mode: "smooth" })),
  };
}
export function pathData(c: Contour): string {
  if (!c.nodes.length) return "";
  let d = `M${c.nodes[0].x},${-c.nodes[0].y}`;
  for (const [a, b] of segments(c)) {
    if (a.out || b.in) {
      const [, p, q] = controls(a, b);
      d += ` C${p.x},${-p.y} ${q.x},${-q.y} ${b.x},${-b.y}`;
    } else d += ` L${b.x},${-b.y}`;
  }
  return d + (c.closed ? " Z" : "");
}
export function drawPath(ctx: CanvasRenderingContext2D | Path2D, c: Contour) {
  if (!c.nodes.length) return;
  ctx.moveTo(c.nodes[0].x, c.nodes[0].y);
  for (const [a, b] of segments(c)) {
    if (a.out || b.in) {
      const [, p, q] = controls(a, b);
      ctx.bezierCurveTo(p.x, p.y, q.x, q.y, b.x, b.y);
    } else ctx.lineTo(b.x, b.y);
  }
  if (c.closed) ctx.closePath();
}
export function resolveObjects(
  p: FontProject,
  id: string,
  seen = new Set<string>(),
): PathObject[] {
  if (seen.has(id)) throw new Error("Component cycle");
  const g = p.glyphs[id];
  if (!g) return [];
  const next = new Set(seen).add(id);
  return [
    ...g.objects,
    ...g.components.flatMap((c) =>
      resolveObjects(p, c.glyphId, next).map((o) => ({
        ...o,
        id: c.id + o.id,
        contours: o.contours.map((path) => transform(path, c.transform)),
      })),
    ),
  ];
}
export function cloneContours(cs: Contour[]): Contour[] {
  return cs.map((c) => ({
    ...c,
    id: uid(),
    nodes: c.nodes.map((n) => ({ ...n, id: uid() })),
  }));
}
