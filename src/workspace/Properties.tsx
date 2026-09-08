import { useState } from "react";
import { useDocument } from "../core/store";
import { useEditor } from "./editorState";
import {
  uid,
  identity,
  type Contour,
  type PathObject,
  type Matrix,
} from "../core/model";
import {
  bounds,
  around,
  transform,
  reverse,
  cloneContours,
  resolveObjects,
  moveHandle,
  lerp,
} from "../core/geometry";
import { runJob } from "../core/jobs";
import { Modal } from "./Modal";
export function Properties() {
  const p = useDocument((s) => s.project),
    id = useDocument((s) => s.selected),
    edit = useDocument((s) => s.edit),
    g = p.glyphs[id],
    e = useEditor(),
    [angle, setAngle] = useState(0),
    [scaleX, setScaleX] = useState(100),
    [scaleY, setScaleY] = useState(100),
    [dx, setDx] = useState(0),
    [dy, setDy] = useState(0),
    [preview, setPreview] = useState<{
      name: string;
      objects: PathObject[];
    } | null>(null),
    [error, setError] = useState("");
  if (!g) return null;
  const selected = (o: PathObject, c: Contour) =>
      e.selection.includes(o.id) || e.selection.includes(c.id),
    cs = g.objects.flatMap((o) => o.contours.filter((c) => selected(o, c))),
    b = bounds(cs),
    pivot =
      e.pivot ??
      (b
        ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
        : { x: 0, y: 0 });
  const change = (name: string, objects: PathObject[]) =>
    edit(name, (p) => ({
      ...p,
      glyphs: { ...p.glyphs, [id]: { ...p.glyphs[id], objects } },
    }));
  const map = (f: (c: Contour) => Contour) =>
    g.objects.map((o) => ({
      ...o,
      contours: o.contours.map((c) => (selected(o, c) ? f(c) : c)),
    }));
  const apply = (m: Matrix) =>
    change(
      "Transform selection",
      map((c) =>
        transform(
          c,
          m,
          e.tool === "node" && e.nodes.length ? new Set(e.nodes) : undefined,
        ),
      ),
    );
  const metric = (key: "advance", v: number) =>
    edit("Change spacing", (p) => ({
      ...p,
      glyphs: { ...p.glyphs, [id]: { ...g, [key]: Math.max(0, v) } },
    }));
  const mode = (value: "corner" | "smooth" | "symmetric") =>
    change(
      "Change node type",
      map((c) => ({
        ...c,
        nodes: c.nodes.map((n, i) => {
          if (!e.nodes.includes(n.id)) return n;
          const next = c.nodes[(i + 1) % c.nodes.length];
          let v = { ...n, mode: value };
          if (value !== "corner") {
            v = { ...v, out: n.out ?? lerp(n, next, 1 / 3) };
            v = moveHandle(v, "out", v.out!);
          }
          return v;
        }),
      })),
    );
  const ref = (rid: string, patch: Record<string, unknown>) =>
    edit("Edit reference", (p) => ({
      ...p,
      glyphs: {
        ...p.glyphs,
        [id]: {
          ...g,
          references: g.references.map((r) =>
            r.id === rid ? { ...r, ...patch } : r,
          ),
        },
      },
    }));
  return (
    <aside className="properties">
      <div className="panel-heading">
        <span>PROPERTIES</span>
        <span>{g.name === " " ? "Space" : g.name}</span>
      </div>
      <section>
        <h3>Letter spacing</h3>
        <label>
          Advance{" "}
          <input
            aria-label="Advance width"
            type="number"
            value={g.advance}
            min={0}
            onChange={(ev) => metric("advance", Number(ev.target.value))}
          />
        </label>
        {b && (
          <p className="muted">
            Left {Math.round(b.minX)} · Right {Math.round(g.advance - b.maxX)}
          </p>
        )}
        {(() => {
          const box = bounds(resolveObjects(p, id).flatMap((o) => o.contours));
          if (!box) return null;
          return (
            <div className="two-fields">
              <label>
                Left bearing
                <input
                  type="number"
                  key={"left" + box.minX}
                  defaultValue={Math.round(box.minX)}
                  onBlur={(ev) => {
                    const dx = Number(ev.target.value) - box.minX;
                    if (!Number.isFinite(dx) || Math.abs(dx) < 0.01) return;
                    edit("Set left bearing", (p) => ({
                      ...p,
                      glyphs: {
                        ...p.glyphs,
                        [id]: {
                          ...g,
                          advance: Math.max(0, g.advance + dx),
                          objects: g.objects.map((o) => ({
                            ...o,
                            contours: o.contours.map((c) =>
                              transform(c, [1, 0, 0, 1, dx, 0]),
                            ),
                          })),
                          components: g.components.map((c) => ({
                            ...c,
                            transform: [
                              ...c.transform.slice(0, 4),
                              c.transform[4] + dx,
                              c.transform[5],
                            ] as Matrix,
                          })),
                        },
                      },
                    }));
                  }}
                />
              </label>
              <label>
                Right bearing
                <input
                  type="number"
                  key={"right" + g.advance + box.maxX}
                  defaultValue={Math.round(g.advance - box.maxX)}
                  onBlur={(ev) => {
                    const value = Number(ev.target.value);
                    if (Number.isFinite(value))
                      metric("advance", Math.max(0, box.maxX + value));
                  }}
                />
              </label>
            </div>
          );
        })()}
        <button
          onClick={() => {
            const all = bounds(
              resolveObjects(p, id).flatMap((o) => o.contours),
            );
            if (all) metric("advance", Math.max(0, Math.round(all.maxX + 60)));
          }}
        >
          Fit spacing to ink
        </button>
      </section>
      <section>
        <h3>Drawing</h3>
        <label>
          Brush{" "}
          <select
            value={e.brush}
            onChange={(ev) =>
              e.set({ brush: ev.target.value as typeof e.brush })
            }
          >
            {["pen", "brush", "nib", "monoline", "chisel"].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label>
          Width{" "}
          <input
            aria-label="Brush width"
            type="range"
            min="2"
            max="180"
            value={e.size}
            onChange={(ev) => e.set({ size: +ev.target.value })}
          />
          <span>{e.size}</span>
        </label>
        <label>
          Stabilization{" "}
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={e.stabilization}
            onChange={(ev) => e.set({ stabilization: +ev.target.value })}
          />
        </label>
        <label>
          Nib angle
          <input
            type="number"
            value={e.nibAngle}
            onChange={(ev) => e.set({ nibAngle: +ev.target.value })}
          />
        </label>
        <label>
          Taper
          <input
            type="range"
            min="0"
            max="1"
            step=".05"
            value={e.taper}
            onChange={(ev) => e.set({ taper: +ev.target.value })}
          />
        </label>
      </section>
      <section>
        <h3>Transform {e.nodes.length ? `${e.nodes.length} nodes` : ""}</h3>
        <p className="muted">
          Select outlines, or choose their nodes. Drag the amber pivot to change
          the rotation center.
        </p>
        <div className="two-fields">
          <label>
            X
            <input
              type="number"
              value={dx}
              onChange={(ev) => setDx(+ev.target.value)}
            />
          </label>
          <label>
            Y
            <input
              type="number"
              value={dy}
              onChange={(ev) => setDy(+ev.target.value)}
            />
          </label>
          <label>
            Rotate °
            <input
              aria-label="Rotation"
              type="number"
              value={angle}
              onChange={(ev) => setAngle(+ev.target.value)}
            />
          </label>
          <label>
            Scale X %
            <input
              type="number"
              value={scaleX}
              onChange={(ev) => setScaleX(+ev.target.value)}
            />
          </label>
          <label>
            Scale Y %
            <input
              type="number"
              value={scaleY}
              onChange={(ev) => setScaleY(+ev.target.value)}
            />
          </label>
        </div>
        <button
          disabled={!cs.length}
          onClick={() => {
            apply(around(pivot, angle, scaleX / 100, scaleY / 100, dx, dy));
            setAngle(0);
            setDx(0);
            setDy(0);
            setScaleX(100);
            setScaleY(100);
          }}
        >
          Apply transform
        </button>
        <div className="button-row">
          <button
            disabled={!cs.length}
            onClick={() => apply(around(pivot, 0, -1, 1))}
          >
            Flip X
          </button>
          <button
            disabled={!cs.length}
            onClick={() => apply(around(pivot, 0, 1, -1))}
          >
            Flip Y
          </button>
          <button
            disabled={!cs.length}
            onClick={() => {
              const copy = {
                id: uid(),
                contours: cloneContours(cs).map((c) =>
                  transform(c, [1, 0, 0, 1, 20, -20]),
                ),
              };
              change("Duplicate", [...g.objects, copy]);
              e.set({ selection: [copy.id], nodes: [] });
            }}
          >
            Duplicate
          </button>
        </div>
        <div className="button-row">
          <button
            disabled={!cs.length}
            onClick={() => {
              const group = uid();
              change(
                "Group selection",
                g.objects.map((o) =>
                  e.selection.includes(o.id) ? { ...o, group } : o,
                ),
              );
            }}
          >
            Group
          </button>
          <button
            disabled={!cs.length}
            onClick={() =>
              change(
                "Ungroup",
                g.objects.map((o) =>
                  e.selection.includes(o.id) ? { ...o, group: undefined } : o,
                ),
              )
            }
          >
            Ungroup
          </button>
          <button
            disabled={!cs.length}
            onClick={() => {
              change(
                "Delete outlines",
                g.objects
                  .filter((o) => !e.selection.includes(o.id))
                  .map((o) => ({
                    ...o,
                    contours: o.contours.filter(
                      (c) => !e.selection.includes(c.id),
                    ),
                  }))
                  .filter((o) => o.contours.length),
              );
              e.set({ selection: [], nodes: [] });
            }}
          >
            Delete
          </button>
        </div>
        <div className="button-row">
          {(["left", "center", "right"] as const).map((align) => (
            <button
              key={align}
              disabled={cs.length < 2}
              onClick={() =>
                change(
                  "Align " + align,
                  map((c) => {
                    const cb = bounds([c])!;
                    const x =
                      align === "left"
                        ? b!.minX - cb.minX
                        : align === "right"
                          ? b!.maxX - cb.maxX
                          : (b!.minX + b!.maxX - cb.minX - cb.maxX) / 2;
                    return transform(c, [1, 0, 0, 1, x, 0]);
                  }),
                )
              }
            >
              {align}
            </button>
          ))}
        </div>
        <button
          disabled={cs.length < 3}
          onClick={() => {
            const sorted = [...cs].sort(
                (a, b) => bounds([a])!.minX - bounds([b])!.minX,
              ),
              start = bounds([sorted[0]])!.minX,
              end = bounds([sorted.at(-1)!])!.minX;
            change(
              "Distribute horizontally",
              map((c) => {
                const i = sorted.indexOf(c);
                return transform(c, [
                  1,
                  0,
                  0,
                  1,
                  start +
                    ((end - start) * i) / (sorted.length - 1) -
                    bounds([c])!.minX,
                  0,
                ]);
              }),
            );
          }}
        >
          Distribute horizontally
        </button>
      </section>
      <section>
        <h3>Curves & nodes</h3>
        <div className="button-row">
          {(["corner", "smooth", "symmetric"] as const).map((m) => (
            <button key={m} disabled={!e.nodes.length} onClick={() => mode(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="button-row">
          <button
            disabled={!e.nodes.length}
            onClick={() =>
              change(
                "Convert to line",
                map((c) => ({
                  ...c,
                  nodes: c.nodes.map((n, i) => ({
                    ...n,
                    out: e.nodes.includes(n.id) ? undefined : n.out,
                    in: e.nodes.includes(
                      c.nodes[(i + c.nodes.length - 1) % c.nodes.length].id,
                    )
                      ? undefined
                      : n.in,
                  })),
                })),
              )
            }
          >
            To line
          </button>
          <button
            disabled={!e.nodes.length}
            onClick={() =>
              change(
                "Convert to curve",
                map((c) => ({
                  ...c,
                  nodes: c.nodes.map((n, i) => ({
                    ...n,
                    out: e.nodes.includes(n.id)
                      ? (n.out ??
                        lerp(n, c.nodes[(i + 1) % c.nodes.length], 1 / 3))
                      : n.out,
                    in: e.nodes.includes(
                      c.nodes[(i + c.nodes.length - 1) % c.nodes.length].id,
                    )
                      ? (n.in ??
                        lerp(
                          c.nodes[(i + c.nodes.length - 1) % c.nodes.length],
                          n,
                          2 / 3,
                        ))
                      : n.in,
                  })),
                })),
              )
            }
          >
            To curve
          </button>
        </div>
        <div className="button-row">
          <button
            disabled={!cs.length}
            onClick={() => change("Reverse contours", map(reverse))}
          >
            Reverse
          </button>
          <button
            disabled={!cs.length}
            onClick={() =>
              change(
                "Close paths",
                map((c) => ({ ...c, closed: true })),
              )
            }
          >
            Close paths
          </button>
          <button
            disabled={e.nodes.length !== 1}
            onClick={() => {
              const objects = g.objects.flatMap((o) => {
                const contours = o.contours.flatMap((c) => {
                  const i = c.nodes.findIndex((n) => e.nodes.includes(n.id));
                  if (i < 0) return [c];
                  if (c.closed) {
                    const ns = [
                      ...c.nodes.slice(i),
                      ...c.nodes.slice(0, i),
                      { ...c.nodes[i], id: uid() },
                    ];
                    ns[0] = { ...ns[0], in: undefined };
                    ns[ns.length - 1] = { ...ns.at(-1)!, out: undefined };
                    return [{ ...c, closed: false, nodes: ns }];
                  }
                  if (i === 0 || i === c.nodes.length - 1) return [c];
                  return [
                    { ...c, nodes: c.nodes.slice(0, i + 1) },
                    {
                      ...c,
                      id: uid(),
                      nodes: [
                        { ...c.nodes[i], id: uid() },
                        ...c.nodes.slice(i + 1),
                      ],
                    },
                  ];
                });
                return [{ ...o, contours }];
              });
              change("Split path", objects);
              e.set({ nodes: [] });
            }}
          >
            Split at node
          </button>
        </div>
        <button
          disabled={e.nodes.length !== 2}
          onClick={() => {
            try {
              const ends = cs.filter(
                (c) =>
                  !c.closed &&
                  [c.nodes[0].id, c.nodes.at(-1)!.id].some((id) =>
                    e.nodes.includes(id),
                  ),
              );
              if (ends.length !== 2)
                throw new Error("Select endpoints on two open contours.");
              let [a, b] = ends;
              if (e.nodes.includes(a.nodes[0].id)) a = reverse(a);
              if (e.nodes.includes(b.nodes.at(-1)!.id)) b = reverse(b);
              const joined = { ...a, nodes: [...a.nodes, ...b.nodes] };
              change(
                "Join paths",
                g.objects
                  .map((o) => ({
                    ...o,
                    contours: o.contours.flatMap((c) =>
                      c.id === a.id ? [joined] : c.id === b.id ? [] : [c],
                    ),
                  }))
                  .filter((o) => o.contours.length),
              );
              e.set({ nodes: [] });
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          Join endpoints
        </button>
        <button
          disabled={!e.nodes.length}
          onClick={() => {
            const objects = map((c) => ({
              ...c,
              nodes: c.nodes.filter((n) => !e.nodes.includes(n.id)),
            })).map((o) => ({
              ...o,
              contours: o.contours.filter((c) => c.nodes.length > 1),
            }));
            setPreview({ name: "Delete nodes", objects });
            e.set({ draft: objects });
          }}
        >
          Delete nodes…
        </button>
        <button
          disabled={!cs.length}
          onClick={async () => {
            try {
              e.set({ busy: true });
              const revision = p.revision,
                contours = await runJob<Contour[]>(
                  "fit",
                  { contours: cs, tolerance: p.metrics.unitsPerEm / 1000 },
                  revision,
                );
              if (useDocument.getState().project.revision !== revision) return;
              let i = 0;
              const objects = map(() => contours[i++]);
              setPreview({ name: "Simplify curves", objects });
              e.set({ draft: objects });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              e.set({ busy: false });
            }
          }}
        >
          Simplify curves…
        </button>
      </section>
      <section>
        <h3>Contours</h3>
        <button
          disabled={cs.length < 2 || e.busy}
          onClick={async () => {
            e.set({ busy: true });
            try {
              const rev = p.revision;
              const merged = await runJob<Contour[]>("union", cs, rev);
              if (useDocument.getState().project.revision !== rev) return;
              const remaining = g.objects
                .map((o) => ({
                  ...o,
                  contours: o.contours.filter((c) => !selected(o, c)),
                }))
                .filter((o) => o.contours.length);
              change("Merge selected outlines", [
                ...remaining,
                { id: uid(), contours: merged },
              ]);
              e.set({ selection: [], nodes: [] });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              e.set({ busy: false });
            }
          }}
        >
          Merge selected outlines
        </button>
        {g.objects.map((o, oi) => (
          <div key={o.id} className="contour-list">
            <button
              className={e.selection.includes(o.id) ? "active" : ""}
              onClick={() =>
                e.set({ selection: [o.id], nodes: [], tool: "select" })
              }
            >
              Outline {oi + 1} ·{" "}
              {o.contours.reduce((n, c) => n + c.nodes.length, 0)} nodes
            </button>
            {o.source && (
              <button
                disabled={e.busy}
                onClick={async () => {
                  e.set({ busy: true });
                  try {
                    const rev = p.revision;
                    const contours = await runJob<Contour[]>(
                      "brush",
                      {
                        points: o.source!.points,
                        settings: {
                          brush: e.brush,
                          size: e.size,
                          nibAngle: e.nibAngle,
                          taper: e.taper,
                        },
                        tolerance: p.metrics.unitsPerEm / 1000,
                      },
                      rev,
                    );
                    if (useDocument.getState().project.revision !== rev) return;
                    const objects = g.objects.map((v) =>
                      v.id === o.id ? { ...v, contours } : v,
                    );
                    setPreview({ name: "Regenerate original stroke", objects });
                    e.set({ draft: objects });
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    e.set({ busy: false });
                  }
                }}
              >
                Regenerate original stroke…
              </button>
            )}
            {o.contours.map((c, i) => (
              <button
                key={c.id}
                className={e.selection.includes(c.id) ? "active" : ""}
                onClick={() =>
                  e.set({ selection: [c.id], nodes: [], tool: "node" })
                }
              >
                ↳ Contour {i + 1} · {c.closed ? "closed" : "open"}
              </button>
            ))}
          </div>
        ))}
      </section>
      <section>
        <h3>References</h3>
        {g.references.length === 0 && (
          <p className="muted">Import a font or image to trace over.</p>
        )}
        {g.references.map((r) => (
          <div className="reference-card" key={r.id}>
            <strong>{r.name}</strong>
            <label>
              <input
                type="checkbox"
                checked={r.visible}
                onChange={(ev) => ref(r.id, { visible: ev.target.checked })}
              />
              Visible
            </label>
            <label>
              <input
                type="checkbox"
                checked={r.locked}
                onChange={(ev) => ref(r.id, { locked: ev.target.checked })}
              />
              Locked
            </label>
            <label>
              Opacity
              <input
                type="range"
                min="0"
                max="1"
                step=".05"
                value={r.opacity}
                onChange={(ev) => ref(r.id, { opacity: +ev.target.value })}
              />
            </label>
            <div className="two-fields">
              <label>
                X
                <input
                  type="number"
                  disabled={r.locked}
                  value={r.transform[4]}
                  onChange={(ev) => {
                    const m = [...r.transform] as Matrix;
                    m[4] = +ev.target.value;
                    ref(r.id, { transform: m });
                  }}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  disabled={r.locked}
                  value={r.transform[5]}
                  onChange={(ev) => {
                    const m = [...r.transform] as Matrix;
                    m[5] = +ev.target.value;
                    ref(r.id, { transform: m });
                  }}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                disabled={r.locked}
                onClick={() => {
                  const m = r.transform,
                    a = around({ x: 0, y: 0 }, 15);
                  ref(r.id, {
                    transform: [
                      a[0] * m[0] + a[2] * m[1],
                      a[1] * m[0] + a[3] * m[1],
                      a[0] * m[2] + a[2] * m[3],
                      a[1] * m[2] + a[3] * m[3],
                      m[4],
                      m[5],
                    ],
                  });
                }}
              >
                Rotate 15°
              </button>
              <button
                disabled={r.locked}
                onClick={() =>
                  ref(r.id, {
                    transform: r.transform.map((v, i) => (i < 4 ? v * 1.1 : v)),
                  })
                }
              >
                Scale +10%
              </button>
              <button
                disabled={r.locked}
                onClick={() => ref(r.id, { transform: identity() })}
              >
                Align baseline
              </button>
            </div>
            {r.contours && (
              <button
                onClick={() =>
                  change("Copy reference outlines", [
                    ...g.objects,
                    {
                      id: uid(),
                      contours: cloneContours(r.contours!).map((c) =>
                        transform(c, r.transform),
                      ),
                    },
                  ])
                }
              >
                Copy outlines to glyph
              </button>
            )}
            <button
              onClick={() =>
                edit("Remove reference", (p) => ({
                  ...p,
                  glyphs: {
                    ...p.glyphs,
                    [id]: {
                      ...g,
                      references: g.references.filter((v) => v.id !== r.id),
                    },
                  },
                }))
              }
            >
              Remove reference
            </button>
          </div>
        ))}
      </section>
      <section>
        <h3>Components</h3>
        <select
          aria-label="Add component"
          value=""
          onChange={(ev) => {
            if (!ev.target.value) return;
            try {
              edit("Add component", (p) => ({
                ...p,
                glyphs: {
                  ...p.glyphs,
                  [id]: {
                    ...g,
                    components: [
                      ...g.components,
                      {
                        id: uid(),
                        glyphId: ev.target.value,
                        transform: identity(),
                      },
                    ],
                  },
                },
              }));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <option value="">Add reusable glyph…</option>
          {Object.values(p.glyphs)
            .filter(
              (v) => v.id !== id && (v.objects.length || v.components.length),
            )
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
        {g.components.map((c) => (
          <div key={c.id}>
            <span>{p.glyphs[c.glyphId]?.name}</span>
            <button
              onClick={() =>
                edit("Detach component", (p) => ({
                  ...p,
                  glyphs: {
                    ...p.glyphs,
                    [id]: {
                      ...g,
                      objects: [
                        ...g.objects,
                        ...resolveObjects(p, c.glyphId).map((o) => ({
                          ...o,
                          id: uid(),
                          contours: cloneContours(o.contours).map((q) =>
                            transform(q, c.transform),
                          ),
                        })),
                      ],
                      components: g.components.filter((q) => q.id !== c.id),
                    },
                  },
                }))
              }
            >
              Detach
            </button>
            <button
              onClick={() =>
                edit("Remove component", (p) => ({
                  ...p,
                  glyphs: {
                    ...p.glyphs,
                    [id]: {
                      ...g,
                      components: g.components.filter((q) => q.id !== c.id),
                    },
                  },
                }))
              }
            >
              Remove
            </button>
          </div>
        ))}
      </section>
      <details>
        <summary>Font metrics</summary>
        {(Object.keys(p.metrics) as (keyof typeof p.metrics)[]).map((k) => (
          <label key={k}>
            {k}
            <input
              type="number"
              value={p.metrics[k]}
              onChange={(ev) => {
                const v = +ev.target.value;
                try {
                  edit("Edit font metrics", (p) => ({
                    ...p,
                    metrics: { ...p.metrics, [k]: v },
                  }));
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
        ))}
      </details>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
      {preview && (
        <Modal
          title={preview.name}
          onClose={() => {
            setPreview(null);
            e.set({ draft: null });
          }}
        >
          <p>
            The canvas previews the changed geometry.{" "}
            {g.objects.reduce(
              (n, o) => n + o.contours.reduce((a, c) => a + c.nodes.length, 0),
              0,
            )}{" "}
            →{" "}
            {preview.objects.reduce(
              (n, o) => n + o.contours.reduce((a, c) => a + c.nodes.length, 0),
              0,
            )}{" "}
            nodes.
          </p>
          <p>
            Deleting nodes reconnects neighboring points and may change the
            outline.
          </p>
          <div className="button-row">
            <button
              onClick={() => {
                setPreview(null);
                e.set({ draft: null });
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                change(preview.name, preview.objects);
                setPreview(null);
                e.set({ draft: null, nodes: [] });
              }}
            >
              Apply
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
