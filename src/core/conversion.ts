import type { TracedContour } from "../lib/geom";
import { flattenContour } from "../lib/geom";
import { ribbonOutline } from "../lib/ink/ribbon";
import { unionContours } from "../lib/ink/booleans";
import {
  node,
  uid,
  newProject,
  identity,
  type Contour,
  type FontProject,
} from "./model";
import { lerp } from "./geometry";
export function fromLegacy(c: TracedContour, baseline = 800): Contour {
  const map = (p: { x: number; y: number }) => ({ x: p.x, y: baseline - p.y });
  const ns = [node(map(c.start))];
  let prev = c.start;
  for (const s of c.segments) {
    const a = ns[ns.length - 1],
      b = node(map(s.p));
    if (s.kind === "C") {
      a.out = map(s.c1);
      b.in = map(s.c2);
    } else if (s.kind === "Q") {
      a.out = map(lerp(prev, s.c, 2 / 3));
      b.in = map(lerp(s.p, s.c, 2 / 3));
    }
    ns.push(b);
    prev = s.p;
  }
  if (
    ns.length > 1 &&
    Math.hypot(ns[0].x - ns.at(-1)!.x, ns[0].y - ns.at(-1)!.y) < 1e-7
  ) {
    ns[0].in = ns.at(-1)!.in;
    ns.pop();
  }
  return { id: uid(), closed: true, nodes: ns };
}
export function legacyContours(value: unknown): TracedContour[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    try {
      if (Array.isArray(c)) {
        if (
          c.length < 3 ||
          !c.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        )
          return [];
        return [
          {
            start: c[0],
            segments: c.slice(1).map((p) => ({ kind: "L" as const, p })),
            points: c,
          },
        ];
      }
      if (
        !c?.start ||
        !Number.isFinite(c.start.x) ||
        !Number.isFinite(c.start.y) ||
        !Array.isArray(c.segments)
      )
        return [];
      for (const s of c.segments) {
        if (!["L", "Q", "C"].includes(s.kind)) return [];
        for (const p of [
          s.p,
          ...(s.kind === "Q" ? [s.c] : s.kind === "C" ? [s.c1, s.c2] : []),
        ])
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
      }
      return [
        {
          start: c.start,
          segments: c.segments,
          points: flattenContour(c.start, c.segments),
        },
      ];
    } catch {
      return [];
    }
  });
}
export function migrateLegacy(raw: string): FontProject {
  const parsed = JSON.parse(raw),
    s = parsed.state ?? parsed;
  if (!s || typeof s !== "object" || !s.glyphs)
    throw new Error("Legacy project is malformed. Original data retained.");
  const p = newProject(
    typeof s.projectName === "string" ? s.projectName : "Recovered handwriting",
  );
  if (Number.isFinite(s.metrics?.xHeight))
    p.metrics.xHeight = s.metrics.xHeight;
  if (Number.isFinite(s.metrics?.capHeight))
    p.metrics.capHeight = s.metrics.capHeight;
  for (const [ch, v] of Object.entries(s.glyphs) as [string, any][]) {
    let id = p.mappings[ch];
    if (!id) {
      id = uid();
      p.mappings[ch] = id;
      p.glyphs[id] = {
        id,
        name: ch,
        advance: 600,
        objects: [],
        references: [],
        components: [],
        anchors: {},
      };
    }
    const g = p.glyphs[id];
    if (v.advanceWidth != null && Number.isFinite(v.advanceWidth))
      g.advance = Math.max(0, v.advanceWidth);
    const list = Array.isArray(v.objects)
      ? v.objects
      : [{ contours: v.baseOutlines }];
    for (const o of list) {
      const cs = legacyContours(o.contours);
      if (cs.length)
        g.objects.push({ id: uid(), contours: cs.map((c) => fromLegacy(c)) });
    }
    if (!Array.isArray(v.objects) && Array.isArray(v.strokes))
      for (const st of v.strokes) {
        if (!Array.isArray(st.points) || !st.points.length) continue;
        const cs = unionContours([
          ribbonOutline(st.points, {
            brush: "pen",
            size: st.width || 28,
            nibAngle: 40,
            taper: 0,
          }),
        ]);
        g.objects.push({ id: uid(), contours: cs.map((c) => fromLegacy(c)) });
      }
    const refs = legacyContours(v.templateOutlines);
    if (refs.length)
      g.references.push({
        id: uid(),
        name: "Migrated template",
        contours: refs.map((c) => fromLegacy(c)),
        opacity: 0.22,
        locked: true,
        visible: true,
        transform: identity(),
      });
  }
  return p;
}
