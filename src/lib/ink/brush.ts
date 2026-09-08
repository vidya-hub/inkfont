import type { StrokePoint } from '../../types'

/**
 * The brush catalog. A brush is a *width-profile function* over the stroke's
 * centerline (plus a cap style) — the ribbon engine turns any profile into a
 * real vector outline, and the boolean union folds it into the glyph's ink.
 * A font is monochrome, so a brush is fully defined by the silhouette it
 * leaves; that's why this small catalog covers everything a font can express.
 */

export type BrushId = 'pen' | 'brush' | 'nib' | 'monoline' | 'chisel'

export interface BrushSettings {
  brush: BrushId
  /** stroke width in em units */
  size: number
  /** broad-nib angle in degrees (nib / chisel) */
  nibAngle: number
  /** velocity taper amount 0..1 (brush pen) */
  taper: number
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  brush: 'pen',
  size: 28,
  nibAngle: 40,
  taper: 0.5,
}

export const BRUSH_CATALOG: { id: BrushId; label: string; hint: string }[] = [
  { id: 'pen', label: 'Pen', hint: 'Pressure-sensitive round pen (previous behavior)' },
  { id: 'brush', label: 'Brush', hint: 'Brush pen — thins with speed, tapers at the ends, pools when slow' },
  { id: 'nib', label: 'Nib', hint: 'Broad-edge calligraphy — width from direction vs nib angle' },
  { id: 'monoline', label: 'Mono', hint: 'Constant width, ignores pressure and speed' },
  { id: 'chisel', label: 'Chisel', hint: 'Broad nib with flat cut ends' },
]

export function usesNibAngle(brush: BrushId): boolean {
  return brush === 'nib' || brush === 'chisel'
}

/** Legacy parity: the pre-v2 pen width for a pressure sample. */
export function widthAt(strokeWidth: number, pressure: number): number {
  const p = pressure > 0 && Number.isFinite(pressure) ? pressure : 0.5
  return strokeWidth * (0.55 + 0.9 * p)
}

export interface WidthSampleInput {
  settings: BrushSettings
  pressure: number
  /** local direction angle in radians (atan2 of motion) */
  direction: number
  /** distance from the previous sample, em units */
  segmentLength: number
  /** 0..1 position along the stroke arc */
  arcPos: number
}

/**
 * Half-width is derived by the ribbon engine; this returns the FULL stroke
 * width at one sample for the active brush.
 */
export function brushWidthAt(input: WidthSampleInput): number {
  const { settings, pressure, direction, segmentLength, arcPos } = input
  const size = Math.max(settings.size, 1)
  const p = pressure > 0 && Number.isFinite(pressure) ? pressure : 0.5
  switch (settings.brush) {
    case 'monoline':
      return size
    case 'nib':
    case 'chisel': {
      // Flat nib of length `size` held at nibAngle φ: sweeping in direction
      // θ lays down a swath w = size·|sin(θ − φ)| (thin parallel, thick
      // perpendicular — the classic broad-edge calligraphy rule).
      const phi = (settings.nibAngle * Math.PI) / 180
      const w = size * Math.abs(Math.sin(direction - phi))
      // Small floor so strokes parallel to the nib never vanish entirely
      return Math.max(w, size * 0.06) * (0.85 + 0.3 * p)
    }
    case 'brush': {
      // Velocity taper: distance-per-sample stands in for speed (dense
      // sampling makes slow strokes short segments). Ends taper like a real
      // brush picking up / lifting off.
      const speed = Math.min(segmentLength / size, 2)
      const velocity = 1 / (1 + settings.taper * 2.2 * speed)
      const endTaper = taperRamp(arcPos, settings.taper)
      return size * (0.22 + 0.95 * p) * velocity * endTaper
    }
    case 'pen':
    default:
      return widthAt(size, p)
  }
}

/** Ramped entry/exit so brush strokes start and end thin. */
function taperRamp(arcPos: number, taper: number): number {
  if (taper <= 0) return 1
  const edge = 0.12 + 0.13 * (1 - taper)
  const entry = smoothstep(0, edge, arcPos)
  const exit = smoothstep(0, edge, 1 - arcPos)
  return Math.min(1, 0.12 + 0.88 * Math.min(entry, exit) ** 0.7)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)))
  return t * t * (3 - 2 * t)
}

export function usesPressure(brush: BrushId): boolean {
  return brush === 'pen' || brush === 'brush' || brush === 'nib'
}

/** Convenience: pressure from a StrokePoint with the standard fallback. */
export function pointPressure(p: StrokePoint): number {
  return p.pressure > 0 && Number.isFinite(p.pressure) ? p.pressure : 0.5
}
