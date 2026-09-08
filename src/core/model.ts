export interface Point {
  x: number;
  y: number;
}
export interface Node extends Point {
  id: string;
  in?: Point;
  out?: Point;
  mode: "corner" | "smooth" | "symmetric";
}
export interface Contour {
  id: string;
  closed: boolean;
  nodes: Node[];
}
export type Matrix = [number, number, number, number, number, number];
export interface PathObject {
  id: string;
  contours: Contour[];
  group?: string;
  source?: { points: (Point & { pressure: number })[]; size: number };
}
export interface ReferenceLayer {
  id: string;
  name: string;
  contours?: Contour[];
  image?: string;
  width?: number;
  height?: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  transform: Matrix;
}
export interface ComponentInstance {
  id: string;
  glyphId: string;
  transform: Matrix;
}
export interface Glyph {
  id: string;
  name: string;
  objects: PathObject[];
  advance: number;
  references: ReferenceLayer[];
  components: ComponentInstance[];
  anchors: Record<string, Point>;
}
export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  xHeight: number;
  capHeight: number;
}
export interface FontProject {
  id: string;
  schemaVersion: 1;
  revision: number;
  name: string;
  style: string;
  updated: number;
  deleted?: number;
  metrics: FontMetrics;
  glyphs: Record<string, Glyph>;
  mappings: Record<string, string>;
  kerning: Record<string, number>;
}
export const uid = () => crypto.randomUUID();
export const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export const node = (p: Point): Node => ({ ...p, id: uid(), mode: "corner" });
export const latin =
  " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ‘’“”–—…€£";
export function makeGlyph(name: string): Glyph {
  return {
    id: uid(),
    name,
    objects: [],
    advance: name === " " ? 300 : 600,
    references: [],
    components: [],
    anchors: {},
  };
}
export function newProject(name = "Untitled handwriting"): FontProject {
  const p: FontProject = {
    id: uid(),
    schemaVersion: 1,
    revision: 0,
    name,
    style: "Regular",
    updated: Date.now(),
    metrics: {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      xHeight: 500,
      capHeight: 700,
    },
    glyphs: {},
    mappings: {},
    kerning: {},
  };
  for (const c of Array.from(latin)) {
    const g = makeGlyph(c);
    p.glyphs[g.id] = g;
    p.mappings[c] = g.id;
  }
  return p;
}
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7;
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const point = (v: unknown): boolean => record(v) && finite(v.x) && finite(v.y);
export function validateProject(value: unknown): FontProject {
  if (!record(value) || value.schemaVersion !== 1)
    throw new Error("Unsupported project version.");
  const p = value;
  if (
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    typeof p.style !== "string" ||
    !finite(p.revision) ||
    !Number.isSafeInteger(p.updated) ||
    !record(p.glyphs) ||
    !record(p.mappings) ||
    !record(p.kerning) ||
    !record(p.metrics)
  )
    throw new Error("Invalid project metadata.");
  if (
    ![
      "unitsPerEm",
      "ascender",
      "descender",
      "lineGap",
      "xHeight",
      "capHeight",
    ].every((k) => finite(p.metrics[k])) ||
    p.metrics.unitsPerEm < 16 ||
    p.metrics.unitsPerEm > 16384 ||
    p.metrics.ascender <= p.metrics.descender
  )
    throw new Error("Invalid font metrics.");
  let count = 0;
  const checkContours = (cs: unknown) => {
    if (!Array.isArray(cs)) throw new Error("Invalid contours.");
    const ids = new Set<string>();
    for (const c of cs) {
      if (
        !record(c) ||
        typeof c.id !== "string" ||
        typeof c.closed !== "boolean" ||
        !Array.isArray(c.nodes)
      )
        throw new Error("Invalid contour.");
      for (const n of c.nodes) {
        if (
          !record(n) ||
          !point(n) ||
          typeof n.id !== "string" ||
          ids.has(n.id) ||
          !["corner", "smooth", "symmetric"].includes(n.mode) ||
          (n.in !== undefined && !point(n.in)) ||
          (n.out !== undefined && !point(n.out))
        )
          throw new Error("Invalid curve node.");
        ids.add(n.id);
        if (++count > 500000) throw new Error("Project exceeds 500,000 nodes.");
      }
    }
  };
  const matrix = (m: unknown) =>
    Array.isArray(m) && m.length === 6 && m.every(finite);
  if (Object.keys(p.glyphs).length > 10000)
    throw new Error("Project exceeds 10,000 glyphs.");
  for (const [id, g] of Object.entries(p.glyphs)) {
    if (
      !record(g) ||
      id !== g.id ||
      typeof g.name !== "string" ||
      !finite(g.advance) ||
      g.advance < 0 ||
      !Array.isArray(g.objects) ||
      !Array.isArray(g.references) ||
      !Array.isArray(g.components) ||
      !record(g.anchors)
    )
      throw new Error("Invalid glyph.");
    if (!Object.values(g.anchors).every(point))
      throw new Error("Invalid anchor.");
    for (const o of g.objects) {
      if (!record(o) || typeof o.id !== "string")
        throw new Error("Invalid object.");
      checkContours(o.contours);
    }
    for (const r of g.references) {
      if (
        !record(r) ||
        typeof r.id !== "string" ||
        typeof r.name !== "string" ||
        !finite(r.opacity) ||
        r.opacity < 0 ||
        r.opacity > 1 ||
        typeof r.visible !== "boolean" ||
        typeof r.locked !== "boolean" ||
        !matrix(r.transform)
      )
        throw new Error("Invalid reference.");
      if (r.contours) checkContours(r.contours);
      if (
        r.image &&
        (typeof r.image !== "string" ||
          !/^data:image\/(png|jpeg|webp);base64,/.test(r.image) ||
          r.image.length > 24000000 ||
          !finite(r.width) ||
          !finite(r.height))
      )
        throw new Error("Invalid image reference.");
    }
    for (const c of g.components)
      if (
        !record(c) ||
        typeof c.id !== "string" ||
        !p.glyphs[c.glyphId] ||
        !matrix(c.transform)
      )
        throw new Error("Invalid component.");
  }
  for (const [c, id] of Object.entries(p.mappings))
    if (Array.from(c).length !== 1 || typeof id !== "string" || !p.glyphs[id])
      throw new Error("Invalid Unicode mapping.");
  for (const [pair, v] of Object.entries(p.kerning))
    if (
      !finite(v) ||
      pair.split("|").length !== 2 ||
      pair.split("|").some((id) => !p.glyphs[id])
    )
      throw new Error("Invalid kerning pair.");
  const done = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error("Component cycle detected.");
    if (done.has(id)) return;
    active.add(id);
    for (const c of p.glyphs[id].components) visit(c.glyphId);
    active.delete(id);
    done.add(id);
  }
  for (const id of Object.keys(p.glyphs)) visit(id);
  return p as FontProject;
}
