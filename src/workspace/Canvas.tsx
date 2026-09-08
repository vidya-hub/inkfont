import { useEffect, useRef, useState } from "react";
import { useDocument } from "../core/store";
import { useEditor } from "./editorState";
import {
  uid,
  node,
  type Point,
  type PathObject,
  type Contour,
  type Matrix,
} from "../core/model";
import {
  drawPath,
  bounds,
  around,
  transform,
  distance,
  nearest,
  moveHandle,
  bend,
  split,
  rectangle,
  ellipse,
  resolveObjects,
  cloneContours,
} from "../core/geometry";
import { runJob } from "../core/jobs";
interface Camera {
  x: number;
  y: number;
  scale: number;
}
type Gesture = {
  pointerType?: string;
  kind: string;
  start: Point;
  screen: Point;
  before: PathObject[];
  selection: string[];
  nodeIds: string[];
  contour?: string;
  node?: string;
  side?: "in" | "out";
  segment?: number;
  t?: number;
  pivot?: Point;
  handle?: Point;
  camera?: Camera;
  points?: (Point & { pressure: number })[];
  pen?: Contour;
  shift?: boolean;
};
const editGlyph = (objects: PathObject[], name: string) => {
  const s = useDocument.getState(),
    id = s.selected;
  s.edit(name, (p) => ({
    ...p,
    glyphs: { ...p.glyphs, [id]: { ...p.glyphs[id], objects } },
  }));
};
export function EditorCanvas() {
  const project = useDocument((s) => s.project),
    id = useDocument((s) => s.selected),
    glyph = project.glyphs[id],
    editor = useEditor(),
    canvas = useRef<HTMLCanvasElement>(null),
    wrap = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    [size, setSize] = useState({ w: 800, h: 640 }),
    [camera, setCamera] = useState<Camera>({ x: 80, y: 500, scale: 0.6 }),
    [hover, setHover] = useState<Point | null>(null),
    [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null),
    [message, setMessage] = useState(""),
    images = useRef(new Map<string, HTMLImageElement>()),
    [imageTick, setImageTick] = useState(0),
    activePointers = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; middle: Point; camera: Camera } | null>(
      null,
    ),
    active = useRef<number | null>(null),
    job = useRef<AbortController | null>(null);
  useEffect(() => {
    const o = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    if (wrap.current) o.observe(wrap.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    setCamera({
      x: size.w * 0.16,
      y: size.h * 0.78,
      scale: Math.min(size.w / 1200, size.h / 1200),
    });
    gesture.current = null;
    job.current?.abort();
    useEditor.setState({
      selection: [],
      nodes: [],
      pivot: null,
      draft: null,
      pen: null,
      busy: false,
    });
    setMarquee(null);
  }, [id, editor.fit, size.w, size.h]);
  useEffect(() => () => job.current?.abort(), []);
  const screen = (p: Point) => ({
    x: camera.x + p.x * camera.scale,
    y: camera.y - p.y * camera.scale,
  });
  const fromScreen = (p: Point) => ({
    x: (p.x - camera.x) / camera.scale,
    y: (camera.y - p.y) / camera.scale,
  });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const snap = (p: Point, bypass: boolean) => {
    if (!editor.snap || bypass) return p;
    const ys = [
        0,
        project.metrics.xHeight,
        project.metrics.capHeight,
        project.metrics.ascender,
        project.metrics.descender,
      ],
      xs = [0, glyph?.advance ?? 600],
      r = 7 / camera.scale;
    for (const o of glyph?.objects ?? [])
      for (const c of o.contours) {
        if (editor.selection.includes(o.id) || editor.selection.includes(c.id))
          continue;
        for (const n of c.nodes) {
          xs.push(n.x);
          ys.push(n.y);
        }
        const b = bounds([c]);
        if (b) {
          xs.push(b.minX, b.maxX);
          ys.push(b.minY, b.maxY);
        }
      }
    const closest = (values: number[], v: number) =>
      values.reduce(
        (best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best),
        Infinity,
      );
    const x = closest(xs, p.x),
      y = closest(ys, p.y);
    return {
      x: Math.abs(x - p.x) < r ? x : p.x,
      y: Math.abs(y - p.y) < r ? y : p.y,
    };
  };
  const objects = editor.draft ?? glyph?.objects ?? [];
  const selectedContours = objects.flatMap((o) =>
    editor.selection.includes(o.id)
      ? o.contours
      : o.contours.filter((c) => editor.selection.includes(c.id)),
  );
  const selectedBounds = bounds(
    editor.tool === "node" && editor.nodes.length
      ? selectedContours.map((c) => ({
          ...c,
          closed: false,
          nodes: c.nodes
            .filter((n) => editor.nodes.includes(n.id))
            .map((n) => ({ ...n, in: undefined, out: undefined })),
        }))
      : selectedContours,
  );
  const pivot =
    editor.pivot ??
    (selectedBounds
      ? {
          x: (selectedBounds.minX + selectedBounds.maxX) / 2,
          y: (selectedBounds.minY + selectedBounds.maxY) / 2,
        }
      : null);
  const controls = selectedBounds
    ? [
        { x: selectedBounds.minX, y: selectedBounds.minY },
        { x: selectedBounds.maxX, y: selectedBounds.minY },
        { x: selectedBounds.maxX, y: selectedBounds.maxY },
        { x: selectedBounds.minX, y: selectedBounds.maxY },
        {
          x: (selectedBounds.minX + selectedBounds.maxX) / 2,
          y: selectedBounds.minY,
        },
        {
          x: selectedBounds.maxX,
          y: (selectedBounds.minY + selectedBounds.maxY) / 2,
        },
        {
          x: (selectedBounds.minX + selectedBounds.maxX) / 2,
          y: selectedBounds.maxY,
        },
        {
          x: selectedBounds.minX,
          y: (selectedBounds.minY + selectedBounds.maxY) / 2,
        },
      ]
    : [];
  useEffect(() => {
    const el = canvas.current;
    if (!el || !glyph) return;
    const dpr = devicePixelRatio || 1;
    el.width = size.w * dpr;
    el.height = size.h * dpr;
    const ctx = el.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#fffdf7";
    ctx.fillRect(0, 0, size.w, size.h);
    const world = () => {
      ctx.setTransform(
        dpr * camera.scale,
        0,
        0,
        -dpr * camera.scale,
        dpr * camera.x,
        dpr * camera.y,
      );
    };
    ctx.font = "11px system-ui";
    for (const [y, label] of [
      [project.metrics.ascender, "Ascender"],
      [project.metrics.capHeight, "Cap height"],
      [project.metrics.xHeight, "x-height"],
      [0, "Baseline"],
      [project.metrics.descender, "Descender"],
    ] as [number, string][]) {
      const sy = screen({ x: 0, y }).y;
      ctx.strokeStyle = y === 0 ? "#9a8059" : "#e5dece";
      ctx.setLineDash(y === 0 ? [] : [4, 5]);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(size.w, sy);
      ctx.stroke();
      ctx.fillStyle = "#8d806b";
      ctx.fillText(label, 12, sy - 6);
    }
    ctx.setLineDash([]);
    for (const x of [0, glyph.advance]) {
      const sx = screen({ x, y: 0 }).x;
      ctx.strokeStyle = "#c8d5c9";
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, size.h);
      ctx.stroke();
    }
    world();
    for (const r of glyph.references) {
      if (!r.visible) continue;
      ctx.save();
      ctx.globalAlpha = r.opacity;
      ctx.transform(...r.transform);
      if (r.contours) {
        ctx.beginPath();
        r.contours.forEach((c) => drawPath(ctx, c));
        ctx.fillStyle = "#4669a6";
        ctx.fill("nonzero");
      }
      if (r.image) {
        let img = images.current.get(r.image);
        if (!img) {
          img = new Image();
          img.onload = () => setImageTick((t) => t + 1);
          img.src = r.image;
          images.current.set(r.image, img);
        }
        if (img.complete) {
          ctx.scale(1, -1);
          ctx.drawImage(
            img,
            0,
            -(r.height ?? 700),
            r.width ?? 700,
            r.height ?? 700,
          );
        }
      }
      ctx.restore();
    }
    const rendered = [
      ...objects,
      ...resolveObjects(
        {
          ...project,
          glyphs: { ...project.glyphs, [id]: { ...glyph, objects: [] } },
        },
        id,
      ),
    ];
    for (const o of rendered) {
      ctx.beginPath();
      o.contours.forEach((c) => drawPath(ctx, c));
      if (!editor.outline) {
        ctx.fillStyle = "#282820";
        ctx.fill("nonzero");
      }
      ctx.strokeStyle = editor.selection.includes(o.id) ? "#cf562c" : "#716b5e";
      ctx.lineWidth =
        (editor.selection.includes(o.id) ? 1.8 : 0.65) / camera.scale;
      if (
        editor.outline ||
        editor.selection.includes(o.id) ||
        o.contours.some((c) => !c.closed)
      )
        ctx.stroke();
      for (const c of o.contours)
        if (editor.selection.includes(c.id)) {
          ctx.beginPath();
          drawPath(ctx, c);
          ctx.strokeStyle = "#cf562c";
          ctx.lineWidth = 1.8 / camera.scale;
          ctx.stroke();
        }
    }
    if (editor.pen) {
      ctx.beginPath();
      drawPath(ctx, editor.pen);
      ctx.strokeStyle = "#c8512c";
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.stroke();
    }
    if (
      gesture.current?.kind === "brush" ||
      gesture.current?.kind === "eraser"
    ) {
      const ps = gesture.current.points ?? [];
      ctx.beginPath();
      ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle =
        gesture.current.kind === "eraser" ? "#dd613766" : "#282820";
      ctx.lineWidth = editor.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      if (ps.length === 1) {
        ctx.beginPath();
        ctx.arc(ps[0].x, ps[0].y, editor.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mark = (p: Point, r: number, fill: string, circle = false) => {
      const q = screen(p);
      ctx.fillStyle = fill;
      ctx.strokeStyle = "#c6532b";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (circle) ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      else ctx.rect(q.x - r, q.y - r, 2 * r, 2 * r);
      ctx.fill();
      ctx.stroke();
    };
    if (editor.tool === "node" || editor.tool === "bezier") {
      const cs =
        editor.tool === "bezier"
          ? editor.pen
            ? [editor.pen]
            : []
          : selectedContours;
      for (const c of cs)
        for (const n of c.nodes) {
          for (const h of [n.in, n.out])
            if (h) {
              const a = screen(n),
                b = screen(h);
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = "#d4a28b";
              ctx.stroke();
              mark(h, 3, "#fffdf7", true);
            }
          mark(n, 4, editor.nodes.includes(n.id) ? "#cf562c" : "#fffdf7");
        }
    }
    if (
      selectedBounds &&
      pivot &&
      (editor.tool === "select" || editor.tool === "node")
    ) {
      const a = screen({ x: selectedBounds.minX, y: selectedBounds.maxY }),
        b = screen({ x: selectedBounds.maxX, y: selectedBounds.minY });
      ctx.strokeStyle = "#cf562c";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      if (editor.tool === "select") {
        controls.forEach((p) => mark(p, 4, "#fffdf7"));
        mark(
          {
            x: (selectedBounds.minX + selectedBounds.maxX) / 2,
            y: selectedBounds.maxY + 30 / camera.scale,
          },
          5,
          "#cf562c",
          true,
        );
        mark(pivot, 4, "#e9b95d", true);
      }
    }
    if (marquee) {
      const a = screen(marquee.a),
        b = screen(marquee.b);
      ctx.fillStyle = "#e2622b15";
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = "#cf562c";
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    if (hover && (editor.tool === "brush" || editor.tool === "eraser")) {
      const h = screen(hover);
      ctx.beginPath();
      ctx.arc(h.x, h.y, (editor.size * camera.scale) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "#9c7759";
      ctx.stroke();
    }
  }, [
    project,
    glyph,
    id,
    objects,
    editor,
    size,
    camera,
    hover,
    marquee,
    imageTick,
  ]);
  const mutate = (g: Gesture, m: Matrix) =>
    g.before.map((o) => ({
      ...o,
      contours: o.contours.map((c) =>
        g.selection.includes(o.id) || g.selection.includes(c.id)
          ? transform(c, m, g.nodeIds.length ? new Set(g.nodeIds) : undefined)
          : c,
      ),
    }));
  const cancel = () => {
    const g = gesture.current;
    if (g?.kind === "bezier" && g.pen)
      useEditor.setState({
        pen:
          g.pen.nodes.length > 1
            ? { ...g.pen, nodes: g.pen.nodes.slice(0, -1) }
            : null,
      });
    gesture.current = null;
    active.current = null;
    useEditor.setState({ draft: null });
    setMarquee(null);
  };
  const finishPen = () => {
    const pen = useEditor.getState().pen;
    if (pen && pen.nodes.length > 1) {
      editGlyph(
        [
          ...useDocument.getState().project.glyphs[id].objects,
          { id: uid(), contours: [pen] },
        ],
        "Draw Bézier path",
      );
    }
    useEditor.setState({ pen: null });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        useDocument.getState().modal ||
        target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      const state = useEditor.getState(),
        doc = useDocument.getState();
      if (e.key === "Escape") {
        if (gesture.current) cancel();
        else if (state.pen) useEditor.setState({ pen: null });
        else useEditor.setState({ selection: [], nodes: [] });
        return;
      }
      if (e.key === "Enter" && state.pen) {
        finishPen();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        cancel();
        e.shiftKey ? doc.redo() : doc.undo();
        useEditor.setState({ selection: [], nodes: [] });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const g = doc.project.glyphs[id],
          copies = g.objects.flatMap((o) =>
            state.selection.includes(o.id)
              ? [
                  {
                    ...o,
                    id: uid(),
                    contours: cloneContours(o.contours).map((c) =>
                      transform(c, [1, 0, 0, 1, 20, -20]),
                    ),
                  },
                ]
              : [],
          );
        editGlyph([...g.objects, ...copies], "Duplicate");
        useEditor.setState({ selection: copies.map((o) => o.id) });
        return;
      }
      if (e.key.startsWith("Arrow") && state.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1,
          dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0,
          dy = e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0;
        editGlyph(
          mutate(
            {
              before: doc.project.glyphs[id].objects,
              selection: state.selection,
              nodeIds: state.tool === "node" ? state.nodes : [],
            } as Gesture,
            [1, 0, 0, 1, dx, dy],
          ),
          "Nudge",
        );
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        state.selection.length
      ) {
        e.preventDefault();
        if (state.nodes.length) {
          setMessage(
            "Use “Delete nodes” in Properties to preview the changed outline.",
          );
          return;
        }
        editGlyph(
          doc.project.glyphs[id].objects
            .filter((o) => !state.selection.includes(o.id))
            .map((o) => ({
              ...o,
              contours: o.contours.filter(
                (c) => !state.selection.includes(c.id),
              ),
            }))
            .filter((o) => o.contours.length),
          "Delete selection",
        );
        useEditor.setState({ selection: [] });
        return;
      }
      if (e.key === "Tab" && state.tool === "node" && state.selection.length) {
        e.preventDefault();
        const ns = selectedContours.flatMap((c) => c.nodes);
        if (ns.length) {
          const index = ns.findIndex((n) => state.nodes.includes(n.id));
          useEditor.setState({
            nodes: [
              ns[(index + (e.shiftKey ? -1 : 1) + ns.length) % ns.length].id,
            ],
          });
        }
        return;
      }
      if (e.key === "0") {
        useEditor.setState({ fit: state.fit + 1 });
        return;
      }
      const tools: Record<string, typeof state.tool> = {
        v: "select",
        a: "node",
        p: "bezier",
        b: "brush",
        e: "eraser",
        h: "hand",
        r: "rectangle",
        o: "ellipse",
      };
      if (!e.ctrlKey && !e.metaKey && tools[e.key])
        useEditor.setState({ tool: tools[e.key] });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [id, selectedContours]);
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (editor.busy || !glyph) return;
    if (e.pointerType === "touch" && gesture.current?.pointerType === "pen")
      return;
    const sp = local(e),
      p = snap(fromScreen(sp), e.altKey);
    activePointers.current.set(e.pointerId, sp);
    if (e.pointerType === "touch" && activePointers.current.size === 2) {
      if (
        active.current !== null &&
        gesture.current?.kind === "brush" &&
        e.isPrimary === false
      ) {
        cancel();
      }
      const [a, b] = [...activePointers.current.values()];
      pinch.current = {
        distance: distance(a, b),
        middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        camera,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (active.current !== null) return;
    if (e.button !== 0 && e.button !== 1) return;
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g: Gesture = {
      kind: editor.tool,
      pointerType: e.pointerType,
      start: p,
      screen: sp,
      before: glyph.objects,
      selection: [...editor.selection],
      nodeIds: editor.tool === "node" ? [...editor.nodes] : [],
      shift: e.shiftKey,
    };
    gesture.current = g;
    if (editor.tool === "hand" || e.button === 1) {
      g.kind = "pan";
      g.camera = camera;
      return;
    }
    if (editor.tool === "brush" || editor.tool === "eraser") {
      g.points = [
        { ...p, pressure: e.pointerType === "pen" ? e.pressure || 0.5 : 0.5 },
      ];
      setHover(p);
      return;
    }
    if (editor.tool === "rectangle" || editor.tool === "ellipse") return;
    if (editor.tool === "bezier") {
      const pen = editor.pen;
      if (
        pen &&
        pen.nodes.length > 2 &&
        distance(p, pen.nodes[0]) < 10 / camera.scale
      ) {
        editGlyph(
          [
            ...glyph.objects,
            { id: uid(), contours: [{ ...pen, closed: true }] },
          ],
          "Close Bézier path",
        );
        useEditor.setState({ pen: null });
        gesture.current = null;
        return;
      }
      g.pen = pen
        ? { ...pen, nodes: [...pen.nodes, node(p)] }
        : { id: uid(), closed: false, nodes: [node(p)] };
      useEditor.setState({ pen: g.pen });
      return;
    }
    if (editor.tool === "select" && selectedBounds && pivot) {
      if (distance(p, pivot) < 8 / camera.scale) {
        g.kind = "pivot";
        return;
      }
      const rotate = {
        x: (selectedBounds.minX + selectedBounds.maxX) / 2,
        y: selectedBounds.maxY + 30 / camera.scale,
      };
      if (distance(p, rotate) < 10 / camera.scale) {
        g.kind = "rotate";
        g.pivot = pivot;
        return;
      }
      const h = controls.find((h) => distance(p, h) < 8 / camera.scale);
      if (h) {
        g.kind = "scale";
        g.handle = h;
        g.pivot = pivot;
        return;
      }
    }
    if (editor.tool === "node") {
      for (const c of selectedContours)
        for (const n of c.nodes) {
          for (const side of ["in", "out"] as const)
            if (n[side] && distance(p, n[side]!) < 8 / camera.scale) {
              g.kind = "handle";
              g.contour = c.id;
              g.node = n.id;
              g.side = side;
              return;
            }
          if (distance(p, n) < 9 / camera.scale) {
            g.kind = "node";
            g.node = n.id;
            g.contour = c.id;
            g.nodeIds = e.shiftKey
              ? [...new Set([...editor.nodes, n.id])]
              : editor.nodes.includes(n.id)
                ? editor.nodes
                : [n.id];
            useEditor.setState({ nodes: g.nodeIds });
            return;
          }
        }
      for (const c of selectedContours) {
        const hit = nearest(c, p);
        if (hit.distance < 9 / camera.scale && hit.t > 0.03 && hit.t < 0.97) {
          g.kind = "segment";
          g.contour = c.id;
          g.segment = hit.i;
          g.t = hit.t;
          return;
        }
      }
    }
    const ctx = canvas.current!.getContext("2d")!;
    let hit: PathObject | undefined;
    for (const o of [...glyph.objects].reverse()) {
      const path = new Path2D();
      o.contours.filter((c) => c.closed).forEach((c) => drawPath(path, c));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const inside = ctx.isPointInPath(path, p.x, p.y, "nonzero");
      ctx.restore();
      if (
        inside ||
        o.contours.some((c) => nearest(c, p).distance < 8 / camera.scale)
      ) {
        hit = o;
        break;
      }
    }
    if (hit) {
      const members = hit.group
        ? glyph.objects.filter((o) => o.group === hit!.group).map((o) => o.id)
        : [hit.id];
      const selected = e.shiftKey
        ? editor.selection.includes(hit.id)
          ? editor.selection.filter((i) => !members.includes(i))
          : [...new Set([...editor.selection, ...members])]
        : editor.selection.includes(hit.id)
          ? editor.selection
          : members;
      g.selection = selected;
      g.nodeIds = [];
      g.kind = editor.tool === "node" ? "pick" : "move";
      useEditor.setState({ selection: selected, nodes: [], pivot: null });
      return;
    }
    g.kind = "marquee";
    setMarquee({ a: p, b: p });
    if (!e.shiftKey)
      useEditor.setState({ selection: [], nodes: [], pivot: null });
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sp = local(e);
    if (activePointers.current.has(e.pointerId))
      activePointers.current.set(e.pointerId, sp);
    if (pinch.current && activePointers.current.size >= 2) {
      const [a, b] = [...activePointers.current.values()],
        q = pinch.current,
        m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        ratio = distance(a, b) / (q.distance || 1),
        s = Math.max(0.05, Math.min(8, q.camera.scale * ratio));
      setCamera({
        scale: s,
        x: m.x - ((q.middle.x - q.camera.x) * s) / q.camera.scale,
        y: m.y - ((q.middle.y - q.camera.y) * s) / q.camera.scale,
      });
      return;
    }
    const p = fromScreen(sp);
    setHover(p);
    if (active.current !== e.pointerId) return;
    const g = gesture.current;
    if (!g) return;
    let dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (e.shiftKey && g.kind === "move") {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (g.kind === "pan") {
      setCamera({
        ...g.camera!,
        x: g.camera!.x + sp.x - g.screen.x,
        y: g.camera!.y + sp.y - g.screen.y,
      });
      return;
    }
    if (g.kind === "pivot") {
      useEditor.setState({ pivot: p });
      return;
    }
    if (g.kind === "marquee") {
      setMarquee({ a: g.start, b: p });
      return;
    }
    if (g.kind === "brush" || g.kind === "eraser") {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const raw = fromScreen(local(ev)),
          last = g.points!.at(-1)!,
          alpha = 1 - editor.stabilization * 0.8,
          point = {
            x: last.x + (raw.x - last.x) * alpha,
            y: last.y + (raw.y - last.y) * alpha,
            pressure:
              e.pointerType === "pen" ? ev.pressure || last.pressure : 0.5,
          };
        if (distance(point, last) > 0.5) g.points!.push(point);
      }
      return;
    }
    if (g.kind === "rectangle" || g.kind === "ellipse") {
      const end = e.shiftKey
          ? {
              x: g.start.x + dx,
              y: g.start.y + Math.sign(dy || 1) * Math.abs(dx),
            }
          : p,
        c =
          g.kind === "rectangle"
            ? rectangle(g.start, end)
            : ellipse(g.start, end);
      useEditor.setState({
        draft: [...g.before, { id: "gesture-shape", contours: [c] }],
      });
      return;
    }
    if (g.kind === "bezier" && g.pen) {
      const ns = g.pen.nodes.map((n) => ({ ...n })),
        n = ns.at(-1)!;
      if (distance(p, g.start) > 3 / camera.scale) {
        n.out = p;
        n.in = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
        n.mode = "symmetric";
      }
      useEditor.setState({ pen: { ...g.pen, nodes: ns } });
      return;
    }
    if (g.kind === "move") {
      useEditor.setState({ draft: mutate(g, [1, 0, 0, 1, dx, dy]) });
      return;
    }
    if (g.kind === "rotate") {
      let angle =
        ((Math.atan2(p.y - g.pivot!.y, p.x - g.pivot!.x) -
          Math.atan2(g.start.y - g.pivot!.y, g.start.x - g.pivot!.x)) *
          180) /
        Math.PI;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      useEditor.setState({ draft: mutate(g, around(g.pivot!, angle)) });
      return;
    }
    if (g.kind === "scale") {
      const q = g.pivot!,
        h = g.handle!,
        sx = Math.abs(h.x - q.x) < 1e-6 ? 1 : (p.x - q.x) / (h.x - q.x),
        sy = Math.abs(h.y - q.y) < 1e-6 ? 1 : (p.y - q.y) / (h.y - q.y);
      useEditor.setState({
        draft: mutate(g, around(q, 0, sx, e.shiftKey ? sx : sy)),
      });
      return;
    }
    if (g.kind === "node") {
      const target = snap(p, e.altKey),
        tx = target.x - g.start.x,
        ty = target.y - g.start.y;
      useEditor.setState({ draft: mutate(g, [1, 0, 0, 1, tx, ty]) });
      return;
    }
    if (g.kind === "handle" || g.kind === "segment") {
      useEditor.setState({
        draft: g.before.map((o) => ({
          ...o,
          contours: o.contours.map((c) =>
            c.id !== g.contour
              ? c
              : g.kind === "segment"
                ? bend(c, g.segment!, g.t!, { x: dx, y: dy })
                : {
                    ...c,
                    nodes: c.nodes.map((n) =>
                      n.id === g.node
                        ? moveHandle(n, g.side!, snap(p, e.altKey), e.altKey)
                        : n,
                    ),
                  },
          ),
        })),
      });
      return;
    }
  };
  const up = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (activePointers.current.size < 2) pinch.current = null;
      cancel();
      return;
    }
    if (active.current !== e.pointerId) return;
    active.current = null;
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const p = fromScreen(local(e));
    if (g.kind === "marquee") {
      const loX = Math.min(g.start.x, p.x),
        hiX = Math.max(g.start.x, p.x),
        loY = Math.min(g.start.y, p.y),
        hiY = Math.max(g.start.y, p.y);
      if (editor.tool === "node" && selectedContours.length) {
        useEditor.setState({
          nodes: [
            ...new Set([
              ...(g.shift ? editor.nodes : []),
              ...selectedContours.flatMap((c) =>
                c.nodes
                  .filter(
                    (n) => n.x >= loX && n.x <= hiX && n.y >= loY && n.y <= hiY,
                  )
                  .map((n) => n.id),
              ),
            ]),
          ],
        });
      } else {
        const ids = g.before
          .filter((o) => {
            const b = bounds(o.contours);
            return (
              b &&
              b.minX >= loX &&
              b.maxX <= hiX &&
              b.minY >= loY &&
              b.maxY <= hiY
            );
          })
          .map((o) => o.id);
        useEditor.setState({
          selection: [...new Set([...(g.shift ? g.selection : []), ...ids])],
        });
      }
      setMarquee(null);
      return;
    }
    const draft = useEditor.getState().draft;
    useEditor.setState({ draft: null });
    if (draft && distance(g.start, p) > 1e-6) {
      editGlyph(
        draft.map((o) => (o.id === "gesture-shape" ? { ...o, id: uid() } : o)),
        "Edit " + g.kind,
      );
      return;
    }
    if (g.kind === "brush" || g.kind === "eraser") {
      const doc = useDocument.getState(),
        rev = doc.project.revision,
        pid = doc.project.id;
      job.current = new AbortController();
      useEditor.setState({ busy: true });
      setMessage("Finishing outline…");
      try {
        const cs = await runJob<Contour[]>(
          "brush",
          {
            points: g.points,
            settings: {
              brush: g.kind === "eraser" ? "monoline" : editor.brush,
              size: editor.size,
              nibAngle: editor.nibAngle,
              taper: editor.taper,
            },
            tolerance: project.metrics.unitsPerEm / 1000,
          },
          rev,
          job.current.signal,
        );
        let result: PathObject[];
        if (g.kind === "eraser") {
          const targets = g.selection.length
            ? g.before.filter((o) => g.selection.includes(o.id))
            : g.before;
          const erased = await runJob<PathObject[]>(
            "erase",
            { objects: targets, cut: cs },
            rev,
            job.current.signal,
          );
          result = g.selection.length
            ? [
                ...g.before.filter((o) => !g.selection.includes(o.id)),
                ...erased,
              ]
            : erased;
        } else
          result = [
            ...g.before,
            {
              id: uid(),
              contours: cs,
              source: { points: g.points!, size: editor.size },
            },
          ];
        const latest = useDocument.getState();
        if (
          latest.project.id === pid &&
          latest.project.revision === rev &&
          latest.selected === id
        )
          editGlyph(result, g.kind === "brush" ? "Draw stroke" : "Erase ink");
        setMessage("");
      } catch (err) {
        if ((err as Error).name !== "AbortError")
          setMessage((err as Error).message);
      } finally {
        useEditor.setState({ busy: false });
      }
    }
  };
  return (
    <div className="canvas-shell" ref={wrap}>
      <canvas
        ref={canvas}
        aria-label="Glyph vector editor"
        tabIndex={0}
        style={{
          touchAction: "none",
          cursor:
            editor.tool === "hand"
              ? "grab"
              : editor.tool === "brush" || editor.tool === "bezier"
                ? "crosshair"
                : "default",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => void up(e)}
        onPointerCancel={(e) => {
          activePointers.current.delete(e.pointerId);
          pinch.current = null;
          cancel();
        }}
        onLostPointerCapture={(e) => {
          activePointers.current.delete(e.pointerId);
          if (active.current === e.pointerId) cancel();
        }}
        onDoubleClick={(e) => {
          if (editor.tool === "select") {
            useEditor.setState({ tool: "node" });
            return;
          }
          if (editor.tool === "node") {
            const p = fromScreen(local(e));
            for (const c of selectedContours) {
              const hit = nearest(c, p);
              if (hit.distance < 10 / camera.scale) {
                editGlyph(
                  glyph.objects.map((o) => ({
                    ...o,
                    contours: o.contours.map((q) =>
                      q.id === c.id ? split(q, hit.i, hit.t) : q,
                    ),
                  })),
                  "Insert node",
                );
                break;
              }
            }
          }
        }}
        onWheel={(e) => {
          const p = local(e),
            factor = Math.exp(-e.deltaY * 0.002),
            scale = Math.max(0.05, Math.min(8, camera.scale * factor));
          setCamera({
            scale,
            x: p.x - ((p.x - camera.x) * scale) / camera.scale,
            y: p.y - ((p.y - camera.y) * scale) / camera.scale,
          });
        }}
      />
      <div className="canvas-info">
        <span>
          {Math.round(camera.scale * 100)}% ·{" "}
          {editor.tool === "node"
            ? "Drag nodes, handles, or curves · Double-click to insert a node"
            : editor.tool === "bezier"
              ? "Click corners · Drag handles · Click first node to close · Enter to finish"
              : "Scroll to zoom · H to pan · 0 to fit"}
        </span>
        <button onClick={() => useEditor.setState({ fit: editor.fit + 1 })}>
          Fit
        </button>
      </div>
      {message && (
        <div className="canvas-message" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
