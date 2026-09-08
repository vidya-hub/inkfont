import Clipper from "clipper-lib";
import { uid, node, type Contour, type Point, type PathObject } from "./model";
import { flatten, distance, lerp, at } from "./geometry";
const scale = 1000;
const paths = (cs: Contour[]) =>
  cs
    .filter((c) => c.closed)
    .map((c) =>
      flatten(c, 0.2).map((p) => ({
        X: Math.round(p.x * scale),
        Y: Math.round(p.y * scale),
      })),
    );
export function booleanContours(
  subject: Contour[],
  clip: Contour[],
  subtract = false,
): Contour[] {
  const engine = new Clipper.Clipper();
  engine.StrictlySimple = true;
  engine.AddPaths(paths(subject), Clipper.PolyType.ptSubject, true);
  if (clip.length) engine.AddPaths(paths(clip), Clipper.PolyType.ptClip, true);
  const result: any[] = [];
  engine.Execute(
    subtract ? Clipper.ClipType.ctDifference : Clipper.ClipType.ctUnion,
    result,
    Clipper.PolyFillType.pftNonZero,
    Clipper.PolyFillType.pftNonZero,
  );
  return result
    .filter((p) => Math.abs(Clipper.Clipper.Area(p)) > 0.01 * scale * scale)
    .map((p) => ({
      id: uid(),
      closed: true,
      nodes: [...p]
        .reverse()
        .map((q: any) => node({ x: q.X / scale, y: q.Y / scale })),
    }));
}
export function erase(objects: PathObject[], cut: Contour[]): PathObject[] {
  return objects.flatMap((o) => {
    const intersection = new Clipper.Clipper();
    intersection.AddPaths(paths(o.contours), Clipper.PolyType.ptSubject, true);
    intersection.AddPaths(paths(cut), Clipper.PolyType.ptClip, true);
    const result: any[] = [];
    intersection.Execute(
      Clipper.ClipType.ctIntersection,
      result,
      Clipper.PolyFillType.pftNonZero,
      Clipper.PolyFillType.pftNonZero,
    );
    if (!result.length) return [o];
    const contours = booleanContours(o.contours, cut, true);
    return contours.length ? [{ ...o, contours }] : [];
  });
}
// Least-squares cubic fitting with recursive error splitting. Corners are retained.
export function fitContour(c: Contour, tolerance = 1): Contour {
  if (c.nodes.length < 4) return c;
  const ps = flatten(c, 0.2);
  if (c.closed && distance(ps[0], ps.at(-1)!) > 1e-6) ps.push(ps[0]);
  const fitted: { a: Point; b: Point; c: Point; d: Point }[] = [];
  function fit(points: Point[], depth = 0) {
    const a = points[0],
      d = points.at(-1)!;
    if (points.length <= 2) {
      fitted.push({ a, b: lerp(a, d, 1 / 3), c: lerp(a, d, 2 / 3), d });
      return;
    }
    const lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
    const total = lengths.at(-1)!;
    if (total < 1e-8) return;
    const ts = lengths.map((l) => l / total);
    let aa = 0,
      ab = 0,
      bb = 0,
      ax = 0,
      ay = 0,
      bx = 0,
      by = 0;
    for (let i = 0; i < points.length; i++) {
      const t = ts[i],
        u = 1 - t,
        A = 3 * u * u * t,
        B = 3 * u * t * t,
        x = points[i].x - u * u * u * a.x - t * t * t * d.x,
        y = points[i].y - u * u * u * a.y - t * t * t * d.y;
      aa += A * A;
      ab += A * B;
      bb += B * B;
      ax += A * x;
      ay += A * y;
      bx += B * x;
      by += B * y;
    }
    const det = aa * bb - ab * ab,
      b =
        Math.abs(det) > 1e-10
          ? { x: (ax * bb - bx * ab) / det, y: (ay * bb - by * ab) / det }
          : lerp(a, d, 1 / 3),
      cc =
        Math.abs(det) > 1e-10
          ? { x: (bx * aa - ax * ab) / det, y: (by * aa - ay * ab) / det }
          : lerp(a, d, 2 / 3);
    let worst = 0,
      index = Math.floor(points.length / 2);
    for (let i = 1; i < points.length - 1; i++) {
      const error = distance(
        at(
          { ...a, id: "fit-a", mode: "corner", out: b },
          { ...d, id: "fit-b", mode: "corner", in: cc },
          ts[i],
        ),
        points[i],
      );
      if (error > worst) {
        worst = error;
        index = i;
      }
    }
    // Also bound overshoot between samples against the source polyline.
    for (let k = 1; k < 32; k++) {
      const p = at(
        { ...a, id: "fit-a", mode: "corner", out: b },
        { ...d, id: "fit-b", mode: "corner", in: cc },
        k / 32,
      );
      let near = Infinity;
      for (let j = 1; j < points.length; j++) {
        const q = points[j - 1],
          r = points[j],
          dx = r.x - q.x,
          dy = r.y - q.y,
          t = Math.max(
            0,
            Math.min(
              1,
              ((p.x - q.x) * dx + (p.y - q.y) * dy) / (dx * dx + dy * dy || 1),
            ),
          );
        near = Math.min(near, distance(p, lerp(q, r, t)));
      }
      worst = Math.max(worst, near);
    }
    if (worst <= tolerance) {
      fitted.push({ a, b, c: cc, d });
      return;
    }
    if (depth > 20) {
      for (let i = 1; i < points.length; i++)
        fit([points[i - 1], points[i]], depth + 1);
      return;
    }
    index = Math.max(1, Math.min(points.length - 2, index));
    fit(points.slice(0, index + 1), depth + 1);
    fit(points.slice(index), depth + 1);
  }
  const corners = [0];
  for (let i = 1; i < ps.length - 1; i++) {
    const a = ps[i - 1],
      b = ps[i],
      d = ps[i + 1],
      den = distance(a, b) * distance(b, d);
    if (
      den &&
      ((b.x - a.x) * (d.x - b.x) + (b.y - a.y) * (d.y - b.y)) / den < 0.7
    )
      corners.push(i);
  }
  corners.push(ps.length - 1);
  for (let i = 1; i < corners.length; i++)
    fit(ps.slice(corners[i - 1], corners[i] + 1));
  if (!fitted.length) return c;
  const nodes = [node(fitted[0].a)];
  for (const s of fitted) {
    nodes.at(-1)!.out = s.b;
    nodes.push({ ...node(s.d), in: s.c });
  }
  if (c.closed) {
    nodes[0].in = nodes.at(-1)!.in;
    nodes.pop();
  }
  return { ...c, nodes };
}
