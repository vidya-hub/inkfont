import * as opentype from "opentype.js";
import {
  uid,
  node,
  makeGlyph,
  newProject,
  type Contour,
  type FontProject,
} from "./model";
import { controls, segments, resolveObjects, bounds, lerp } from "./geometry";
export function parseFont(buffer: ArrayBuffer, name: string): FontProject {
  if (buffer.byteLength > 32 * 1024 * 1024)
    throw new Error("Font exceeds 32 MB.");
  const font = opentype.parse(buffer),
    p = newProject(name.replace(/\.[^.]+$/, "")),
    factor = 1000 / font.unitsPerEm;
  p.name = font.names.fontFamily?.en ?? p.name;
  p.glyphs = {};
  p.mappings = {};
  p.metrics = {
    unitsPerEm: 1000,
    ascender: Math.round(font.ascender * factor),
    descender: Math.round(font.descender * factor),
    lineGap: 0,
    xHeight: 500,
    capHeight: 700,
  };
  let total = 0;
  const map = (x: number, y: number) => ({ x: x * factor, y: y * factor });
  for (let i = 1; i < font.glyphs.length; i++) {
    const source = font.glyphs.get(i);
    const g = makeGlyph(source.name || "glyph " + i),
      contours: Contour[] = [];
    let c: Contour | undefined;
    for (const cmd of source.path.commands) {
      if (++total > 500000) throw new Error("Font contains too many points.");
      if (cmd.type === "M") {
        c = { id: uid(), closed: false, nodes: [node(map(cmd.x, cmd.y))] };
        contours.push(c);
      } else if (cmd.type === "Z") {
        if (c) {
          c.closed = true;
          const last = c.nodes.at(-1)!,
            first = c.nodes[0];
          if (
            c.nodes.length > 1 &&
            Math.hypot(last.x - first.x, last.y - first.y) < 1e-7
          ) {
            first.in = last.in;
            c.nodes.pop();
          }
        }
      } else if (c) {
        const a = c.nodes.at(-1)!,
          b = node(map(cmd.x, cmd.y));
        if (cmd.type === "C") {
          a.out = map(cmd.x1, cmd.y1);
          b.in = map(cmd.x2, cmd.y2);
        } else if (cmd.type === "Q") {
          const q = map(cmd.x1, cmd.y1);
          a.out = lerp(a, q, 2 / 3);
          b.in = lerp(b, q, 2 / 3);
        }
        c.nodes.push(b);
      }
    }
    g.advance = Math.max(0, Math.round((source.advanceWidth ?? 600) * factor));
    if (contours.length) g.objects = [{ id: uid(), contours }];
    p.glyphs[g.id] = g;
    for (const cp of source.unicodes ??
      (source.unicode === undefined ? [] : [source.unicode]))
      if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff))
        p.mappings[String.fromCodePoint(cp)] = g.id;
  }
  for (const [ch, key] of [
    ["H", "capHeight"],
    ["x", "xHeight"],
  ] as const) {
    const b = bounds(
      p.glyphs[p.mappings[ch]]?.objects.flatMap((o) => o.contours) ?? [],
    );
    if (b) p.metrics[key] = Math.round(b.maxY);
  }
  return p;
}
export interface Finding {
  glyphId?: string;
  message: string;
  severity: "error" | "warning";
}
export function inspectFont(p: FontProject): Finding[] {
  const out: Finding[] = [];
  for (const g of Object.values(p.glyphs)) {
    const cs = resolveObjects(p, g.id).flatMap((o) => o.contours);
    if (cs.some((c) => !c.closed))
      out.push({
        glyphId: g.id,
        message: `${g.name}: close open contours before export.`,
        severity: "error",
      });
    const b = bounds(cs);
    if (b && (b.maxY > p.metrics.ascender || b.minY < p.metrics.descender))
      out.push({
        glyphId: g.id,
        message: `${g.name}: ink extends beyond vertical metrics.`,
        severity: "warning",
      });
    if (b && b.maxX > g.advance)
      out.push({
        glyphId: g.id,
        message: `${g.name}: ink extends past its advance.`,
        severity: "warning",
      });
  }
  return out;
}
export function compileFont(p: FontProject): ArrayBuffer {
  const errors = inspectFont(p).filter((f) => f.severity === "error");
  if (errors.length) throw new Error(errors[0].message);
  const missing = new opentype.Path();
  missing.moveTo(50, 0);
  missing.lineTo(50, 700);
  missing.lineTo(450, 700);
  missing.lineTo(450, 0);
  missing.close();
  missing.moveTo(100, 50);
  missing.lineTo(400, 50);
  missing.lineTo(400, 650);
  missing.lineTo(100, 650);
  missing.close();
  const glyphs = [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: missing }),
    ],
    index: Record<string, number> = {};
  for (const g of Object.values(p.glyphs)) {
    const objects = resolveObjects(p, g.id),
      codes = Object.entries(p.mappings)
        .filter(([, id]) => id === g.id)
        .map(([ch]) => ch.codePointAt(0)!);
    if (
      !objects.length &&
      !codes.includes(32) &&
      !Object.values(p.glyphs).some((x) =>
        x.components.some((c) => c.glyphId === g.id),
      )
    )
      continue;
    const path = new opentype.Path();
    for (const c of objects.flatMap((o) => o.contours)) {
      if (!c.nodes.length) continue;
      path.moveTo(c.nodes[0].x, c.nodes[0].y);
      for (const [a, b] of segments(c)) {
        if (a.out || b.in) {
          const [, q, r] = controls(a, b);
          path.curveTo(q.x, q.y, r.x, r.y, b.x, b.y);
        } else path.lineTo(b.x, b.y);
      }
      if (c.closed) path.close();
    }
    index[g.id] = glyphs.length;
    const glyph = new opentype.Glyph({
      name: "g" + glyphs.length,
      advanceWidth: Math.round(g.advance),
      unicode: codes[0],
      path,
    });
    for (const cp of codes.slice(1)) glyph.addUnicode(cp);
    glyphs.push(glyph);
  }
  const font = new opentype.Font({
    familyName: p.name.trim() || "Inkfont",
    styleName: p.style || "Regular",
    unitsPerEm: p.metrics.unitsPerEm,
    ascender: p.metrics.ascender,
    descender: p.metrics.descender,
    glyphs,
  });
  font.tables.hhea = {
    ...(font.tables.hhea ?? {}),
    lineGap: p.metrics.lineGap,
  };
  font.tables.os2 = {
    ...(font.tables.os2 ?? {}),
    sxHeight: p.metrics.xHeight,
    sCapHeight: p.metrics.capHeight,
    sTypoAscender: p.metrics.ascender,
    sTypoDescender: p.metrics.descender,
    sTypoLineGap: p.metrics.lineGap,
  };
  const pairs = Object.entries(p.kerning)
    .flatMap(([k, v]) => {
      const [a, b] = k.split("|");
      return index[a] && index[b]
        ? [
            [
              index[a],
              index[b],
              Math.max(-32768, Math.min(32767, Math.round(v))),
            ],
          ]
        : [];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return appendKern(font.toArrayBuffer(), pairs);
}
// OpenType.js cannot write pair positioning. Add a standard horizontal kern table,
// rebuild the SFNT directory, and recalculate head.checkSumAdjustment.
export function appendKern(
  buffer: ArrayBuffer,
  pairs: number[][],
): ArrayBuffer {
  if (!pairs.length) return buffer;
  if (pairs.length > 10000) throw new Error("Too many kerning pairs.");
  const src = new DataView(buffer),
    n = src.getUint16(4),
    tables: { tag: string; data: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16,
      tag = String.fromCharCode(...new Uint8Array(buffer, o, 4));
    if (tag === "kern") continue;
    const bytes = new Uint8Array(
      buffer.slice(
        src.getUint32(o + 8),
        src.getUint32(o + 8) + src.getUint32(o + 12),
      ),
    );
    if (tag === "head") new DataView(bytes.buffer).setUint32(8, 0);
    tables.push({ tag, data: bytes });
  }
  const kb = new ArrayBuffer(18 + pairs.length * 6),
    k = new DataView(kb);
  k.setUint16(2, 1);
  k.setUint16(6, kb.byteLength - 4);
  k.setUint16(8, 1);
  k.setUint16(10, pairs.length);
  const pow = 2 ** Math.floor(Math.log2(pairs.length));
  k.setUint16(12, pow * 6);
  k.setUint16(14, Math.log2(pow));
  k.setUint16(16, pairs.length * 6 - pow * 6);
  pairs.forEach(([a, b, v], i) => {
    k.setUint16(18 + i * 6, a);
    k.setUint16(20 + i * 6, b);
    k.setInt16(22 + i * 6, v);
  });
  tables.push({ tag: "kern", data: new Uint8Array(kb) });
  tables.sort((a, b) => a.tag.localeCompare(b.tag));
  const size =
      12 +
      16 * tables.length +
      tables.reduce((s, t) => s + Math.ceil(t.data.length / 4) * 4, 0),
    out = new ArrayBuffer(size),
    view = new DataView(out),
    bytes = new Uint8Array(out);
  view.setUint32(0, src.getUint32(0));
  view.setUint16(4, tables.length);
  const pp = 2 ** Math.floor(Math.log2(tables.length));
  view.setUint16(6, pp * 16);
  view.setUint16(8, Math.log2(pp));
  view.setUint16(10, tables.length * 16 - pp * 16);
  let offset = 12 + tables.length * 16,
    head = 0;
  const checksum = (data: Uint8Array) => {
    let sum = 0;
    for (let i = 0; i < data.length; i += 4)
      sum =
        (sum +
          ((data[i] ?? 0) * 0x1000000 +
            ((data[i + 1] ?? 0) << 16) +
            ((data[i + 2] ?? 0) << 8) +
            (data[i + 3] ?? 0))) >>>
        0;
    return sum;
  };
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    for (let j = 0; j < 4; j++) bytes[o + j] = t.tag.charCodeAt(j);
    view.setUint32(o + 4, checksum(t.data));
    view.setUint32(o + 8, offset);
    view.setUint32(o + 12, t.data.length);
    bytes.set(t.data, offset);
    if (t.tag === "head") head = offset;
    offset += Math.ceil(t.data.length / 4) * 4;
  });
  view.setUint32(head + 8, (0xb1b0afba - checksum(bytes)) >>> 0);
  return out;
}
