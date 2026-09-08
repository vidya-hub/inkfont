import type { StrokePoint } from '../../types'
import { brushWidthAt, type BrushSettings } from './brush'
import type { Pt, TracedContour } from '../geom'

/**
 * Ribbon engine: converts a stroke's centerline + brush settings into the
 * actual vector outline the brush lays down. This outline is what gets
 * boolean-unioned into the glyph's ink — draw time and export time produce
 * the identical shape.
 *
 * The raw ribbon polygon may self-intersect on sharp turns; the boolean
 * union that follows (NonZero) collapses it into clean, simple contours.
 */

const CAP_STEPS = 10

interface Sample {
  p: Pt
  /** unit normal (left of motion) */
  n: Pt
  /** full stroke width at this sample */
  w: number
}

function samplesOf(points: StrokePoint[], settings: BrushSettings): Sample[] {
  const n = points.length
  const samples: Sample[] = []
  // total arc length for the taper parameter
  let arc = 0
  const arcAt: number[] = [0]
  for (let i = 1; i < n; i++) {
    arc += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    arcAt.push(arc)
  }
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(n - 1, i + 1)]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    let len = Math.hypot(dx, dy)
    if (len < 1e-6) {
      dx = 1
      dy = 0
      len = 1
    }
    const direction = Math.atan2(dy, dx)
    const segmentLength = i === 0 ? 0 : Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    const w = brushWidthAt({
      settings,
      pressure: points[i].pressure,
      direction,
      segmentLength,
      arcPos: arc > 0 ? arcAt[i] / arc : 0,
    })
    samples.push({
      p: { x: points[i].x, y: points[i].y },
      n: { x: -dy / len, y: dx / len },
      w: Math.max(w, 0.4),
    })
  }
  return samples
}

function arcPoints(center: Pt, radius: number, fromAngle: number, sweep: number, includeFirst: boolean): Pt[] {
  const pts: Pt[] = []
  for (let k = 1; k < CAP_STEPS; k++) {
    const a = fromAngle + (sweep * k) / CAP_STEPS
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius })
  }
  if (includeFirst) {
    const a = fromAngle
    pts.unshift({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius })
  }
  return pts
}

function polygonOf(samples: Sample[], settings: BrushSettings): Pt[] {
  const n = samples.length
  const first = samples[0]
  const last = samples[n - 1]
  const left = samples.map((s) => ({ x: s.p.x + s.n.x * (s.w / 2), y: s.p.y + s.n.y * (s.w / 2) }))
  const right = samples.map((s) => ({ x: s.p.x - s.n.x * (s.w / 2), y: s.p.y - s.n.y * (s.w / 2) }))
  const loop: Pt[] = []

  if (n === 1) {
    // Single tap: full circle
    const r = first.w / 2
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      loop.push({ x: first.p.x + Math.cos(a) * r, y: first.p.y + Math.sin(a) * r })
    }
    return loop
  }

  // Left side, start → end
  for (let i = 0; i < n; i++) loop.push(left[i])

  // End cap: left[n-1] → right[n-1], bulging forward (direction of motion).
  // left[n-1] sits at angle a0 (its normal); the front (+d) is at a0 − π/2,
  // right[n-1] at a0 − π → sweep −π.
  if (settings.brush === 'chisel') {
    const { ux, uy } = nibUnit(last, settings.nibAngle)
    loop.push({ x: last.p.x + ux * (last.w / 2), y: last.p.y + uy * (last.w / 2) })
    loop.push({ x: last.p.x - ux * (last.w / 2), y: last.p.y - uy * (last.w / 2) })
  } else {
    const a0 = Math.atan2(last.n.y, last.n.x)
    loop.push(...arcPoints(last.p, last.w / 2, a0, -Math.PI, false))
    loop.push(right[n - 1])
  }

  // Right side, end → start (right[n-1] already added)
  for (let i = n - 2; i >= 0; i--) loop.push(right[i])

  // Start cap: right[0] → left[0], bulging backward (against motion).
  // right[0] sits at a0 + π; the back (−d) is at a0 + π/2, left[0] at a0
  // → sweep −π from a0 + π.
  if (settings.brush === 'chisel') {
    const { ux, uy } = nibUnit(first, settings.nibAngle)
    loop.push({ x: first.p.x - ux * (first.w / 2), y: first.p.y - uy * (first.w / 2) })
  } else {
    const a0 = Math.atan2(first.n.y, first.n.x)
    loop.push(...arcPoints(first.p, first.w / 2, a0 + Math.PI, -Math.PI, false))
  }
  // loop closes implicitly back to left[0]
  return loop
}

/** Nib direction unit vector at a sample, flipped so it faces the left normal. */
function nibUnit(s: Sample, nibAngleDeg: number): { ux: number; uy: number } {
  const phi = (nibAngleDeg * Math.PI) / 180
  let ux = Math.cos(phi)
  let uy = Math.sin(phi)
  if (ux * s.n.x + uy * s.n.y < 0) {
    ux = -ux
    uy = -uy
  }
  return { ux, uy }
}

/**
 * The outline a brush stroke lays down. Returns a single (possibly
 * self-intersecting) closed contour — run it through `unionContours` to get
 * clean ink.
 */
export function ribbonOutline(points: StrokePoint[], settings: BrushSettings): TracedContour {
  const samples = samplesOf(points, settings)
  const loop = polygonOf(samples, settings)
  const start = loop[0]
  const segments = loop.slice(1).map((p) => ({ kind: 'L' as const, p: { x: p.x, y: p.y } }))
  return { start, segments, points: loop }
}

/**
 * The region an eraser sweep removes: constant-width round ribbon along the
 * pointer path (stamps merged continuously — can't tunnel between events).
 */
export function sweepOutline(path: StrokePoint[], radius: number): TracedContour {
  return ribbonOutline(path, { brush: 'monoline', size: radius * 2, nibAngle: 0, taper: 0 })
}
