import ClipperLib from 'clipper-lib'
import { contoursBBox, orientContours, type Pt, type TracedContour } from '../geom'

/**
 * Exact boolean operations on ink outlines (Clipper 6, NonZero fill rule —
 * the same rule fonts use). This is what makes the vector eraser exact and
 * the exported font identical to the canvas: ink is real geometry, never a
 * bitmap trace.
 *
 * Coordinates are scaled to integers (SCALE units per em) for Clipper's
 * integer math; 0.01 em precision is far below visual and font size.
 */

const SCALE = 100

type ClipperPath = { X: number; Y: number }[]

function toClipper(contours: TracedContour[]): ClipperPath[] {
  const paths: ClipperPath[] = []
  for (const c of contours) {
    if (c.points.length < 3) continue
    const path: ClipperPath = []
    for (const p of c.points) {
      path.push({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })
    }
    // Drop a duplicated closing point — Clipper closes implicitly
    if (path.length > 1) {
      const first = path[0]
      const last = path[path.length - 1]
      if (first.X === last.X && first.Y === last.Y) path.pop()
    }
    if (path.length >= 3) paths.push(path)
  }
  return paths
}

function fromClipper(paths: ClipperPath[]): TracedContour[] {
  const out: TracedContour[] = []
  for (const path of paths) {
    if (path.length < 3) continue
    const pts: Pt[] = path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }))
    const start = pts[0]
    const segments = pts.slice(1).map((p) => ({ kind: 'L' as const, p: { x: p.x, y: p.y } }))
    out.push({ start, segments, points: pts })
  }
  return out
}

function execute(clipType: number, subjects: ClipperPath[], clips: ClipperPath[]): ClipperPath[] {
  if (subjects.length === 0) return []
  const cpr = new ClipperLib.Clipper()
  cpr.StrictlySimple = true
  cpr.AddPaths(subjects, ClipperLib.PolyType.ptSubject, true)
  if (clips.length > 0) cpr.AddPaths(clips, ClipperLib.PolyType.ptClip, true)
  const solution: ClipperPath[] = new ClipperLib.Paths()
  cpr.Execute(
    clipType,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  // Clean near-duplicate vertices (2 = 0.02 em) and drop sub-speck contours
  const cleaned: ClipperPath[] = ClipperLib.Clipper.CleanPolygons(solution, 2)
  return cleaned.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) >= 2 * SCALE)
}

/** Union of everything — the glyph's printable ink. Empty input → []. */
export function unionGroups(groups: TracedContour[][]): TracedContour[] {
  const subjects: ClipperPath[] = []
  for (const g of groups) subjects.push(...toClipper(g))
  if (subjects.length === 0) return []
  const result = execute(ClipperLib.ClipType.ctUnion, subjects, [])
  return orientContours(fromClipper(result))
}

export function unionContours(contours: TracedContour[]): TracedContour[] {
  return unionGroups([contours])
}

/**
 * Subtract `cut` from `target`. Returns the SAME array reference when
 * nothing was touched (cut has no overlap), so callers can rely on identity
 * to detect changes and caches survive untouched.
 */
export function differenceContours(target: TracedContour[], cut: TracedContour[]): TracedContour[] {
  if (target.length === 0 || cut.length === 0) return target
  // BBox fast-path: no overlap at bounding-box granularity → untouched
  const tb = contoursBBox(target)
  const cb = contoursBBox(cut)
  if (!tb || !cb || tb.maxX < cb.minX || tb.minX > cb.maxX || tb.maxY < cb.minY || tb.minY > cb.maxY) {
    return target
  }
  const result = execute(ClipperLib.ClipType.ctDifference, toClipper(target), toClipper(cut))
  const out = fromClipper(result)
  return orientContours(out)
}
