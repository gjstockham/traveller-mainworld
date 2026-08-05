/**
 * Drawing primitives for the overlays: blend a pixel, fill a box, blit text.
 *
 * Everything here works in **sRGB bytes**, not in linear light, and that is
 * deliberate. An overlay is ink on a printed map: it is not part of the scene,
 * it is not lit, and blending it in linear space would make a 50%-opacity white
 * graticule line come out visibly brighter than the halfway point a reader
 * expects between the line's colour and the terrain's. Photoshop, every map
 * renderer and every reader's intuition composite annotation in display space.
 * The terrain underneath has already been through `encodeChannel` by the time
 * the overlay pass runs, so this is also the cheap order.
 */
import { CHANNELS, pixelOffset } from '../raster.js';
import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, glyphColumns, glyphPixel } from './font.js';

/** An sRGB byte triple. */
export type Ink = readonly [number, number, number];

/**
 * Blend `ink` over pixel `(px, py)` at opacity `alpha`.
 *
 * Out-of-bounds pixels are dropped rather than wrapped. A glyph that runs off
 * the right edge should lose its tail, not reappear on the left — which is what
 * an unchecked `pixelOffset` would do, silently, and only on the one export
 * whose title happened to be long.
 */
export function blend(
  data: Uint8Array,
  width: number,
  height: number,
  px: number,
  py: number,
  ink: Ink,
  alpha: number,
): void {
  if (px < 0 || py < 0 || px >= width || py >= height || alpha <= 0) {
    return;
  }
  const at = pixelOffset(width, px, py);
  if (alpha >= 1) {
    data[at] = ink[0];
    data[at + 1] = ink[1];
    data[at + 2] = ink[2];
    return;
  }
  for (let c = 0; c < CHANNELS; c++) {
    data[at + c] = Math.round(data[at + c]! + (ink[c]! - data[at + c]!) * alpha);
  }
}

/** Blend `ink` over an axis-aligned box, clipped to the image. */
export function fillBox(
  data: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  ink: Ink,
  alpha: number,
): void {
  const xEnd = Math.min(width, x0 + w);
  const yEnd = Math.min(height, y0 + h);
  for (let y = Math.max(0, y0); y < yEnd; y++) {
    for (let x = Math.max(0, x0); x < xEnd; x++) {
      blend(data, width, height, x, y, ink, alpha);
    }
  }
}

/**
 * Draw `text` with its top-left corner at `(x, y)`, `scale` pixels per font
 * pixel.
 *
 * Integer scaling only, so a glyph stays crisp at any size — a 4096-wide map
 * wants scale 2 or 3 and gets exactly the same shapes a 1024-wide map gets at
 * scale 1. Anti-aliasing a bitmap font would be the wrong kind of effort: what
 * makes small text legible on a map is contrast against a solid panel, which
 * `fillBox` provides.
 *
 * @returns the x coordinate one advance past the last glyph.
 */
export function drawText(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  text: string,
  ink: Ink,
  scale = 1,
  alpha = 1,
): number {
  let penX = x;
  for (let i = 0; i < text.length; i++) {
    const offset = glyphColumns(text.charCodeAt(i));
    for (let col = 0; col < GLYPH_WIDTH; col++) {
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        if (!glyphPixel(offset, col, row)) {
          continue;
        }
        const px0 = penX + col * scale;
        const py0 = y + row * scale;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            blend(data, width, height, px0 + sx, py0 + sy, ink, alpha);
          }
        }
      }
    }
    penX += GLYPH_ADVANCE * scale;
  }
  return penX;
}

/** Height of `lines` lines of text at `scale`, including the gaps between them. */
export function textBlockHeight(lines: number, scale: number, lineGap: number): number {
  return lines === 0 ? 0 : lines * GLYPH_HEIGHT * scale + (lines - 1) * lineGap;
}
