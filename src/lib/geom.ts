import { BASELINE_Y } from './metrics'
import type { Stroke, StrokePoint } from '../types'

/**
 * Curve-preserving outline geometry, shared by the canvas renderer, the font
 * importer, the vectorizer, and the exporter.
 *
 * A `TracedContour` is an implicitly-closed contour: `start` + a chain of
 * L/Q/C `segments` are the source of truth (curves survive into the exported
 * font exactly), while `points` is the flattened polygon twin used for
 * bounding boxes, winding tests, and eraser hit-testing.
 */

export interface Pt {
  x: number
  y: number
}

export type Segment = { kind: 'L'; p: Pt } | { kind: 'Q'; c: Pt; p: Pt } | { kind: 'C'; c1: Pt; c2: Pt; p: Pt }

export interface TracedContour {
  /** MoveTo target: where the contour starts. */
  start: Pt
  /** True curve segments — source of truth for smooth font export. */
  segments: Segment[]
  /** Flattened polygon — for bbox, winding tests, and canvas fills. */
  points: Pt[]
}

// ---------------------------------------------------------------------------
// Flattening + transforms
// ---------------------------------------------------------------------------

/** Flatten one segment into line points, excluding the segment's start point. */
function sampleSegment(from: Pt, s: Segment): Pt[] {
  if (s.kind === 'L') return [{ ...s.p }]
  const ctrlLen =
    s.kind === 'Q'
      ? Math.hypot(s.c.x - from.x, s.c.y - from.y) + Math.hypot(s.p.x - s.c.x, s.p.y - s.c.y)
      : Math.hypot(s.c1.x - from.x, s.c1.y - from.y) +
        Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) +
        Math.hypot(s.p.x - s.c2.x, s.p.y - s.c2.y)
  // ~1 point per 6 units keeps curves faithful without point spam
  const steps = Math.min(24, Math.max(4, Math.ceil(ctrlLen / 6)))
  const out: Pt[] = []
  for (let k = 1; k <= steps; k++) {
    const t = k / steps
    const mt = 1 - t
    if (s.kind === 'Q') {
      out.push({
        x: mt * mt * from.x + 2 * mt * t * s.c.x + t * t * s.p.x,
        y: mt * mt * from.y + 2 * mt * t * s.c.y + t * t * s.p.y,
      })
    } else {
      out.push({
        x: mt * mt * mt * from.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t * t * t * s.p.x,
        y: mt * mt * mt * from.y + 3 * mt * mt * t * s.c1.y + 3 * mt * mt * t * s.c2.y + t * t * t * s.p.y,
      })
    }
  }
  return out
}

/** Flatten a segment list into a polygon (start point first, implicitly closed). */
export function flattenContour(start: Pt, segments: Segment[]): Pt[] {
  const points: Pt[] = [{ ...start }]
  let from = start
  for (const s of segments) {
    for (const p of sampleSegment(from, s)) points.push(p)
    from = s.p
  }
  return points
}

/** Apply a coordinate transform to a whole contour (points re-flattened). */
export function mapContour(c: TracedContour, f: (p: Pt) => Pt): TracedContour {
  const start = f(c.start)
  const segments: Segment[] = c.segments.map((s) =>
    s.kind === 'L'
      ? { kind: 'L', p: f(s.p) }
      : s.kind === 'Q'
        ? { kind: 'Q', c: f(s.c), p: f(s.p) }
        : { kind: 'C', c1: f(s.c1), c2: f(s.c2), p: f(s.p) },
  )
  return { start, segments, points: flattenContour(start, segments) }
}

/** Plain polygon (e.g. legacy persisted outlines) as a contour of L segments. */
export function polygonToTraced(points: Pt[]): TracedContour | null {
  if (!Array.isArray(points) || points.length < 3) return null
  const start = { ...points[0] }
  const segments: Segment[] = points.slice(1).map((p) => ({ kind: 'L' as const, p: { x: p.x, y: p.y } }))
  return { start, segments, points: points.map((p) => ({ x: p.x, y: p.y })) }
}

/** Shift a contour by (dx, dy) — the move tool's whole-glyph drag. */
export function translateContour(c: TracedContour, dx: number, dy: number): TracedContour {
  return mapContour(c, (p) => ({ x: p.x + dx, y: p.y + dy }))
}

/** Convert a contour to font units: y-up with the baseline at y=0. */
export function contourToFontUnits(contour: TracedContour): TracedContour {
  return mapContour(contour, (p) => ({ x: p.x, y: BASELINE_Y - p.y }))
}

// ---------------------------------------------------------------------------
// Bounding boxes (cached per contour identity — contours are treated as
// immutable once committed, so WeakMap caching is safe)
// ---------------------------------------------------------------------------

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const bboxCache = new WeakMap<TracedContour, BBox>()

export function contourBBox(c: TracedContour): BBox {
  const cached = bboxCache.get(c)
  if (cached) return cached
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of c.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const box = { minX, minY, maxX, maxY }
  bboxCache.set(c, box)
  return box
}

export function contoursBBox(contours: TracedContour[]): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours) {
    const b = contourBBox(c)
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

// ---------------------------------------------------------------------------
// Canvas rasterization: contours as Path2D (cached), filled evenodd so
// unwinding-normalized imports still show hollow counters.
// ---------------------------------------------------------------------------

export function contourToPath2D(c: TracedContour): Path2D {
  const path = new Path2D()
  path.moveTo(c.start.x, c.start.y)
  for (const s of c.segments) {
    if (s.kind === 'L') path.lineTo(s.p.x, s.p.y)
    else if (s.kind === 'Q') path.quadraticCurveTo(s.c.x, s.c.y, s.p.x, s.p.y)
    else path.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p.x, s.p.y)
  }
  path.closePath()
  return path
}

const pathCache = new WeakMap<TracedContour, Path2D>()

/** Path2D per contour, rebuilt only when the contour object is new. */
export function cachedContourPath(c: TracedContour): Path2D {
  let p = pathCache.get(c)
  if (!p) {
    p = contourToPath2D(c)
    pathCache.set(c, p)
  }
  return p
}

/**
 * One combined Path2D for a whole outline set so nested counters stay hollow
 * under a single fill (evenodd agrees with the oriented export on
 * well-formed glyphs and never paints counters solid).
 */
export function combinedContourPath(contours: TracedContour[]): Path2D | null {
  let combined: Path2D | null = null
  for (const c of contours) {
    if (c.segments.length === 0) continue
    if (!combined) combined = new Path2D()
    combined.addPath(cachedContourPath(c))
  }
  return combined
}

// ---------------------------------------------------------------------------
// Erasing: distance-to-segment hit tests (not point proximity — fast strokes
// and long imported segments must be cut when the eraser crosses them, even
// between recorded points). Touched segments drop; surviving runs close into
// their own contours/strokes. Untouched objects keep identity so downstream
// Path2D caches stay valid.
// ---------------------------------------------------------------------------

/** Squared distance from (px, py) to the segment a→b. */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return (px - ax) ** 2 + (py - ay) ** 2
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx
  const qy = ay + t * dy
  return (px - qx) ** 2 + (py - qy) ** 2
}

/** Point on a segment at parameter t (0 = from, 1 = end). */
function segmentPointAt(from: Pt, s: Segment, t: number): Pt {
  const mt = 1 - t
  if (s.kind === 'L') return { x: mt * from.x + t * s.p.x, y: mt * from.y + t * s.p.y }
  if (s.kind === 'Q') {
    return {
      x: mt * mt * from.x + 2 * mt * t * s.c.x + t * t * s.p.x,
      y: mt * mt * from.y + 2 * mt * t * s.c.y + t * t * s.p.y,
    }
  }
  return {
    x: mt * mt * mt * from.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t * t * t * s.p.x,
    y: mt * mt * mt * from.y + 3 * mt * mt * t * s.c1.y + 3 * mt * mt * t * s.c2.y + t * t * t * s.p.y,
  }
}

/** Number of sub-segments used to hit-test a curved segment. */
function hitSteps(s: Segment): number {
  return s.kind === 'L' ? 1 : s.kind === 'Q' ? 6 : 10
}

/**
 * Pixel-wise stroke eraser: any segment within radius r of (x, y) is cut,
 * splitting strokes into the runs that survive (pressure/width travel with
 * each point; cut ends get round caps). Returns the same array when nothing
 * was hit; untouched strokes keep object identity so Path2D caches stay valid.
 */
export function eraseStrokes(strokes: Stroke[], x: number, y: number, r: number): Stroke[] {
  const r2 = r * r
  const kept: Stroke[] = []
  let changed = false
  for (const s of strokes) {
    const pts = s.points
    if (pts.length === 0) {
      changed = true
      continue
    }
    // Cheap pass: any segment (or lone dot) within radius?
    let hit = false
    if (pts.length === 1) {
      hit = (pts[0].x - x) ** 2 + (pts[0].y - y) ** 2 < r2
    } else {
      for (let i = 0; i + 1 < pts.length && !hit; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        if (distToSegmentSq(x, y, a.x, a.y, b.x, b.y) < r2) hit = true
      }
    }
    if (!hit) {
      kept.push(s)
      continue
    }
    changed = true
    if (pts.length === 1) continue // lone dot dropped
    // Second pass: emit the surviving runs
    let run: StrokePoint[] = []
    const pushRun = () => {
      if (run.length > 0) kept.push({ width: s.width, points: run })
      run = []
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (distToSegmentSq(x, y, a.x, a.y, b.x, b.y) < r2) {
        pushRun()
      } else {
        if (run.length === 0) run.push(a)
        run.push(b)
      }
    }
    pushRun()
  }
  return changed ? kept : strokes
}

/** Any part of this segment within r of (x, y)? (curves are walked in sub-segments) */
function segmentHit(from: Pt, s: Segment, x: number, y: number, r2: number): boolean {
  const steps = hitSteps(s)
  let px = from.x
  let py = from.y
  for (let k = 1; k <= steps; k++) {
    const q = segmentPointAt(from, s, k / steps)
    if (distToSegmentSq(x, y, px, py, q.x, q.y) < r2) return true
    px = q.x
    py = q.y
  }
  return false
}

/** True when any contour geometry comes within r of (x, y) — used for picking. */
export function contoursHit(contours: TracedContour[], x: number, y: number, r: number): boolean {
  const r2 = r * r
  for (const c of contours) {
    const b = contourBBox(c)
    if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) continue
    let from = c.start
    if ((from.x - x) ** 2 + (from.y - y) ** 2 < r2) return true
    for (const s of c.segments) {
      if (segmentHit(from, s, x, y, r2)) return true
      from = s.p
    }
  }
  return false
}

/**
 * Erase all contour parts within radius r of (x, y). Returns the same array
 * object when nothing was hit; a new array (untouched contours shared)
 * otherwise. Contours reduced below 3 points are dropped.
 */
export function eraseContours(contours: TracedContour[], x: number, y: number, r: number): TracedContour[] {
  const r2 = r * r
  let changed = false
  const out: TracedContour[] = []
  for (const c of contours) {
    const b = contourBBox(c)
    if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) {
      out.push(c)
      continue
    }
    // Per-segment survival runs
    const runs: { start: Pt; segments: Segment[] }[] = []
    let from = c.start
    let run: { start: Pt; segments: Segment[] } | null = null
    for (const s of c.segments) {
      if (segmentHit(from, s, x, y, r2)) {
        if (run) {
          runs.push(run)
          run = null
        }
      } else if (run) {
        run.segments.push(s)
      } else {
        run = { start: from, segments: [s] }
      }
      from = s.p
    }
    if (run) runs.push(run)

    if (runs.length === c.segments.length || runs.length === 0) {
      // Nothing hit (fast path when bbox was hit by radius margin only) or
      // everything gone. Zero surviving segments drops the contour.
      if (runs.length === c.segments.length) out.push(c)
      changed = true
      continue
    }
    changed = true
    for (const run of runs) {
      const points = flattenContour(run.start, run.segments)
      if (points.length >= 3) out.push({ start: { ...run.start }, segments: run.segments, points })
    }
  }
  return changed ? out : contours
}

// ---------------------------------------------------------------------------
// Winding orientation for the nonzero font fill rule
// ---------------------------------------------------------------------------

/** Signed area; positive = counter-clockwise in a standard math (y-up) frame. */
export function signedArea(contour: Pt[]): number {
  let area = 0
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i]
    const b = contour[(i + 1) % contour.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function pointInContour(pt: Pt, contour: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i]
    const b = contour[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Fix contour orientations so the exported font renders holes correctly
 * (e.g. the counters of o, e, a) under the nonzero winding rule.
 */
export function orientContours(contours: TracedContour[]): TracedContour[] {
  if (contours.length === 0) return contours
  const items = contours
    .map((contour) => ({ contour, area: Math.abs(signedArea(contour.points)) }))
    .sort((a, b) => b.area - a.area)

  const depth = new Array<number>(items.length).fill(0)
  for (let i = 0; i < items.length; i++) {
    // Parent = smallest contour that fully contains this one's first point
    let parent = -1
    let parentArea = Infinity
    for (let j = 0; j < items.length; j++) {
      if (j === i || items[j].area <= items[i].area) continue
      if (pointInContour(items[i].contour.points[0], items[j].contour.points)) {
        if (items[j].area < parentArea) {
          parentArea = items[j].area
          parent = j
        }
      }
    }
    depth[i] = parent === -1 ? 0 : depth[parent] + 1
  }

  return items.map((item, idx) => {
    // We are in y-down em-canvas coords; flipping to font coords negates the
    // signed area, so outers (even depth) must be positive HERE to end up
    // clockwise (negative) in y-up font units.
    const targetPositive = depth[idx] % 2 === 0
    const isPositive = signedArea(item.contour.points) > 0
    return targetPositive === isPositive ? item.contour : reverseContour(item.contour)
  })
}

/** Reverse a contour's direction, remapping segments (C controls swap). */
function reverseContour(c: TracedContour): TracedContour {
  const ends: Pt[] = [c.start]
  for (const s of c.segments) ends.push(s.p)
  const segments: Segment[] = []
  for (let i = c.segments.length - 1; i >= 0; i--) {
    const s = c.segments[i]
    const p = ends[i]
    if (s.kind === 'L') segments.push({ kind: 'L', p })
    else if (s.kind === 'Q') segments.push({ kind: 'Q', c: s.c, p })
    else segments.push({ kind: 'C', c1: s.c2, c2: s.c1, p })
  }
  const start = ends[ends.length - 1]
  return { start, segments, points: flattenContour(start, segments) }
}
