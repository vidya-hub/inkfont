/**
 * Single source of truth for coordinate systems.
 *
 * "Em-canvas" coordinates (what strokes are stored in):
 *   - Square em box of EM x EM units, y grows DOWNWARD (canvas-style).
 *   - x=0 is the glyph origin (left edge of the em box), x=EM the right edge.
 *   - y=0 is the ascender line, y=BASELINE_Y is the baseline, y=EM is the descender line.
 *
 * "Font" coordinates (what goes into the TTF):
 *   - Same scale, but y grows UPWARD and the baseline is y=0.
 *
 * View transform: the editor shows VIEW_SPAN x VIEW_SPAN em-canvas units
 * (em box + VIEW_PAD padding on all sides) mapped onto a square canvas.
 */

export const EM = 1000
/** Ascender height above baseline, in font units. */
export const ASCENDER = 800
/** Descender depth below baseline, in font units. */
export const DESCENDER = 200
/** y position of the baseline in em-canvas coordinates. */
export const BASELINE_Y = EM - DESCENDER

/** Editor view padding around the em box, in em-canvas units. */
export const VIEW_PAD = 150
/** Total width/height of the editor view in em-canvas units. */
export const VIEW_SPAN = EM + VIEW_PAD * 2

/** Default left/right side bearing applied when normalizing glyph ink. */
export const SIDE_BEARING = 60

/** em-canvas y (down from ascender) -> font y (up from baseline) */
export function toFontY(y: number): number {
  return BASELINE_Y - y
}

/** font y (up from baseline) -> em-canvas y (down from ascender) */
export function toCanvasY(fontY: number): number {
  return BASELINE_Y - fontY
}

export interface ViewTransform {
  /** CSS pixels per em-canvas unit */
  scale: number
  /** CSS-pixel position of em-canvas (0,0) */
  offsetX: number
  offsetY: number
}

/**
 * View transform for a square canvas covering VIEW_SPAN em units.
 * `panX` shifts the view window horizontally (em units, + = view moves right):
 * used to center narrow glyphs on screen without touching their coordinates.
 */
export function makeViewTransform(cssSize: number, panX = 0): ViewTransform {
  const scale = cssSize / VIEW_SPAN
  return { scale, offsetX: (VIEW_PAD - panX) * scale, offsetY: VIEW_PAD * scale }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
