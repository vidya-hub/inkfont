import { describe, it, expect, beforeAll } from "vitest";
import "fake-indexeddb/auto";
import * as opentype from "opentype.js";
import {
  newProject,
  node,
  uid,
  validateProject,
  identity,
} from "../src/core/model";
import {
  at,
  split,
  bend,
  moveHandle,
  ellipse,
  rectangle,
  bounds,
  around,
  transform,
  flatten,
  reverse,
} from "../src/core/geometry";
import { parseFont, compileFont } from "../src/core/font";
import { erase, fitContour } from "../src/core/operations";
import {
  projectArchive,
  readArchive,
  ProjectRepository,
} from "../src/core/repository";
import { migrateLegacy } from "../src/core/conversion";
import { traceImage } from "../src/core/trace";
import { homography, projectPoint } from "../src/core/worksheet";
const square = () => rectangle({ x: 60, y: 0 }, { x: 500, y: 700 });
describe("Bézier geometry", () => {
  it("splits cubics exactly", () => {
    const c = {
        id: uid(),
        closed: false,
        nodes: [
          { ...node({ x: 0, y: 0 }), out: { x: 20, y: 90 } },
          { ...node({ x: 100, y: 0 }), in: { x: 80, y: 90 } },
        ],
      },
      s = split(c, 0, 0.4);
    for (let k = 0; k <= 20; k++) {
      const t = k / 20,
        a = at(c.nodes[0], c.nodes[1], t),
        b =
          t <= 0.4
            ? at(s.nodes[0], s.nodes[1], t / 0.4)
            : at(s.nodes[1], s.nodes[2], (t - 0.4) / 0.6);
      expect(b.x).toBeCloseTo(a.x, 8);
      expect(b.y).toBeCloseTo(a.y, 8);
    }
  });
  it("bends a line with stationary endpoints and no cumulative drift", () => {
    const c = {
        id: uid(),
        closed: false,
        nodes: [node({ x: 0, y: 0 }), node({ x: 100, y: 0 })],
      },
      d = bend(c, 0, 0.5, { x: 0, y: 30 });
    expect(at(d.nodes[0], d.nodes[1], 0.5).y).toBeCloseTo(30);
    expect(d.nodes[0].x).toBe(0);
    expect(d.nodes[1].x).toBe(100);
  });
  it("constrains smooth/symmetric handles and permits corners", () => {
    const n = {
      ...node({ x: 0, y: 0 }),
      in: { x: -10, y: 0 },
      out: { x: 10, y: 0 },
      mode: "symmetric" as const,
    };
    expect(moveHandle(n, "out", { x: 0, y: 20 }).in).toEqual({ x: 0, y: -20 });
    expect(moveHandle(n, "out", { x: 0, y: 20 }, true).in).toEqual(n.in);
  });
  it("computes extrema without sampled bounds", () => {
    const c = {
      id: uid(),
      closed: false,
      nodes: [
        { ...node({ x: 0, y: 0 }), out: { x: 0, y: 100 } },
        { ...node({ x: 100, y: 0 }), in: { x: 100, y: 100 } },
      ],
    };
    expect(bounds([c])!.maxY).toBe(75);
  });
  it("rotates about a custom pivot", () => {
    const c = transform(square(), around({ x: 60, y: 0 }, 90));
    expect(c.nodes[0].x).toBeCloseTo(60);
    expect(c.nodes[1].x).toBeCloseTo(-640);
  });
  it("erases a rectangle even with an unchanged vertex count", () => {
    const c = rectangle({ x: 0, y: 0 }, { x: 100, y: 100 }),
      cut = rectangle({ x: 50, y: -10 }, { x: 110, y: 110 });
    const result = erase([{ id: "a", contours: [c] }], [cut]);
    expect(bounds(result[0].contours)!.maxX).toBe(50);
  });
  it("preserves untouched curve identity when erasing elsewhere", () => {
    const c = ellipse({ x: 0, y: 0 }, { x: 100, y: 100 }),
      o = { id: "a", contours: [c] };
    expect(
      erase([o], [rectangle({ x: 200, y: 200 }, { x: 250, y: 250 })])[0],
    ).toBe(o);
  });
  it("fits a polygon circle without losing its bounds", () => {
    const c = ellipse({ x: 0, y: 0 }, { x: 100, y: 100 }),
      poly = { ...c, nodes: flatten(c).slice(0, -1).map(node) },
      fit = fitContour(poly, 1);
    expect(fit.nodes.length).toBeLessThan(poly.nodes.length);
    const b = bounds([fit])!;
    expect(b.minX).toBeGreaterThan(-1);
    expect(b.maxX).toBeLessThan(101);
  });
});
describe("font import and export", () => {
  it.each([1000, 2048])("imports %i UPM without double scaling", (upm) => {
    const path = new opentype.Path();
    path.moveTo(upm * 0.1, upm * 0.7);
    path.lineTo(upm * 0.5, 0);
    path.lineTo(0, 0);
    path.close();
    const font = new opentype.Font({
      familyName: "Fixture",
      styleName: "Regular",
      unitsPerEm: upm,
      ascender: upm * 0.8,
      descender: -upm * 0.2,
      glyphs: [
        new opentype.Glyph({
          name: ".notdef",
          advanceWidth: 500,
          path: new opentype.Path(),
        }),
        new opentype.Glyph({
          name: "A",
          unicode: 65,
          advanceWidth: upm * 0.6,
          path,
        }),
      ],
    });
    const p = parseFont(font.toArrayBuffer(), "test.otf"),
      g = p.glyphs[p.mappings.A];
    expect(g.objects[0].contours[0].nodes[0].x).toBeCloseTo(100, 0);
    expect(g.objects[0].contours[0].nodes[0].y).toBeCloseTo(700, 0);
  });
  it("preserves cubic outlines and kerning through export", () => {
    const p = newProject();
    for (const c of ["A", "V"])
      p.glyphs[p.mappings[c]].objects = [
        { id: uid(), contours: [ellipse({ x: 50, y: 0 }, { x: 500, y: 700 })] },
      ];
    p.kerning[p.mappings.A + "|" + p.mappings.V] = -80;
    const f = opentype.parse(compileFont(p));
    expect(f.charToGlyph("A").path.commands.some((c) => c.type === "C")).toBe(
      true,
    );
    expect(f.getKerningValue(f.charToGlyph("A"), f.charToGlyph("V"))).toBe(-80);
  });
  it("does not reuse geometry across project resets", () => {
    const a = newProject(),
      b = newProject();
    a.glyphs[a.mappings.A].objects = [{ id: uid(), contours: [square()] }];
    b.glyphs[b.mappings.A].objects = [
      { id: uid(), contours: [rectangle({ x: 20, y: 0 }, { x: 200, y: 100 })] },
    ];
    compileFont(a);
    expect(
      opentype.parse(compileFont(b)).charToGlyph("A").getBoundingBox().y2,
    ).toBe(100);
  });
  it("rejects open outlines", () => {
    const p = newProject();
    p.glyphs[p.mappings.A].objects = [
      { id: uid(), contours: [{ ...square(), closed: false }] },
    ];
    expect(() => compileFont(p)).toThrow("close open contours");
  });
});
describe("local documents", () => {
  it("round-trips editable archives with Unicode and references", () => {
    const p = newProject(),
      g = p.glyphs[p.mappings.A];
    g.objects = [{ id: uid(), contours: [square()] }];
    g.references = [
      {
        id: uid(),
        name: "reference",
        contours: [square()],
        opacity: 0.3,
        visible: true,
        locked: true,
        transform: identity(),
      },
    ];
    const r = readArchive(projectArchive(p));
    expect(r.glyphs).toEqual(p.glyphs);
    expect(r.id).not.toBe(p.id);
  });
  it("rejects malformed nested geometry", () => {
    const p = newProject();
    p.glyphs[p.mappings.A].objects = [
      {
        id: uid(),
        contours: [
          { ...square(), nodes: [{ id: "bad", x: NaN, y: 0, mode: "corner" }] },
        ],
      },
    ];
    expect(() => validateProject(p)).toThrow("Invalid curve node");
  });
  it("rejects component cycles", () => {
    const p = newProject(),
      a = p.mappings.A,
      b = p.mappings.B;
    p.glyphs[a].components = [{ id: uid(), glyphId: b, transform: identity() }];
    p.glyphs[b].components = [{ id: uid(), glyphId: a, transform: identity() }];
    expect(() => validateProject(p)).toThrow("cycle");
  });
  it("migrates legacy coordinates without dropping editable curves", () => {
    const p = migrateLegacy(
      JSON.stringify({
        state: {
          projectName: "Old",
          glyphs: {
            A: {
              objects: [
                {
                  contours: [
                    {
                      start: { x: 60, y: 100 },
                      segments: [
                        {
                          kind: "Q",
                          c: { x: 100, y: 0 },
                          p: { x: 200, y: 100 },
                        },
                        { kind: "L", p: { x: 60, y: 100 } },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    );
    expect(p.glyphs[p.mappings.A].objects[0].contours[0].nodes[0].y).toBe(700);
    expect(
      p.glyphs[p.mappings.A].objects[0].contours[0].nodes[0].out,
    ).toBeDefined();
  });
  it("stores, conflicts, trashes, and restores transactions", async () => {
    const repo = new ProjectRepository(),
      p = newProject();
    await repo.save(p, null);
    expect((await repo.load(p.id)).glyphs).toEqual(p.glyphs);
    await repo.save({ ...p, revision: 1 }, 0);
    await expect(repo.save({ ...p, revision: 2 }, 0)).rejects.toThrow(
      "CONFLICT",
    );
    await repo.remove(p.id);
    expect(
      (await repo.list()).find((x) => x.id === p.id)?.deleted,
    ).toBeTruthy();
    await repo.restore(p.id);
    expect((await repo.load(p.id)).deleted).toBeUndefined();
  });
});
describe("tracing and worksheets", () => {
  it("preserves a counter and a detached dot", () => {
    const w = 30,
      h = 30,
      px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 4; y < 26; y++)
      for (let x = 4; x < 26; x++)
        if (x < 8 || x >= 22 || y < 8 || y >= 22) {
          const i = (y * w + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    const cs = traceImage({
      pixels: px,
      width: w,
      height: h,
      threshold: 128,
      tolerance: 0,
      noise: 0,
    });
    expect(cs.length).toBe(3);
    const area = (c: (typeof cs)[0]) =>
      c.nodes.reduce((s, a, i) => {
        const b = c.nodes[(i + 1) % c.nodes.length];
        return s + a.x * b.y - b.x * a.y;
      }, 0);
    expect(cs.map(area).some((a) => a > 0)).toBe(true);
    expect(cs.map(area).some((a) => a < 0)).toBe(true);
  });
  it("maps all four perspective markers exactly", () => {
    const a = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      b = [
        { x: 10, y: 5 },
        { x: 130, y: 20 },
        { x: 110, y: 120 },
        { x: 0, y: 90 },
      ],
      h = homography(a, b);
    a.forEach((p, i) => {
      expect(projectPoint(h, p).x).toBeCloseTo(b[i].x, 8);
      expect(projectPoint(h, p).y).toBeCloseTo(b[i].y, 8);
    });
  });
});
