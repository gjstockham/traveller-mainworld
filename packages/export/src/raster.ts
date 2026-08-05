/**
 * The output image buffer, and the step that turns a palette colour into a byte.
 *
 * ## Two colour spaces, and the export has to cross between them
 *
 * `core/palette` emits **linear** RGB — its own header says so, and the viewer
 * hands those floats straight to a `MeshStandardMaterial` vertex-colour
 * attribute, which Three.js takes to be in the renderer's linear working space.
 * A PNG on disk is **sRGB**: every viewer, browser and wiki will apply the sRGB
 * transfer function to it.
 *
 * So the export encodes. Writing the linear float straight into the byte would
 * produce a file that is visibly darker than the same numbers on screen — linear
 * 0.5 is sRGB 0.735, so a mid-grey regolith would land two stops down — and it
 * would be darker for a reason no reader could diagnose from the picture.
 *
 * **The crossing is named and it is the last step.** Everything upstream of
 * {@link encodeChannel} is linear and is bit-comparable with the viewer's vertex
 * colour buffer; that is the comparison PRD §9.4's "matches the 3D view" is
 * asserted as, and `render.test.ts` makes it against `writeSurfaceColour`
 * directly. Once a pixel is a byte it has been through a transfer function and
 * an 8-bit quantiser, and comparing *that* to anything requires saying which.
 *
 * ## NaN
 *
 * A `Uint8Array` turns a NaN into a plausible 0 — the same exposure
 * `quantiseAlbedo` guards in the kernel, and an exporter has it with none of the
 * kernel's guards. `writeSurfaceColour` clamps, but a clamp written as
 * `v < 0 ? 0 : v > 1 ? 1 : v` passes NaN through both comparisons untouched, so
 * the clamp is not the guard. {@link encodeChannel} is.
 */
import type { ImageSize } from './size.js';

/** Bytes per pixel. RGB, no alpha: a map has no transparency to carry. */
export const CHANNELS = 3;

/** An 8-bit RGB image. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  /** `width · height · 3` bytes, row-major, top row first. */
  readonly data: Uint8Array;
}

/** Allocate a black raster of the given size. */
export function allocateRaster(size: ImageSize): Raster {
  return {
    width: size.width,
    height: size.height,
    data: new Uint8Array(size.width * size.height * CHANNELS),
  };
}

/** Byte offset of pixel `(px, py)`. */
export function pixelOffset(width: number, px: number, py: number): number {
  return (py * width + px) * CHANNELS;
}

/**
 * Linear `[0, 1]` to an sRGB byte.
 *
 * The IEC 61966-2-1 transfer function, the one `Math.pow` in the package that
 * does real work, and the reason `core/palette`'s header spends a paragraph on
 * `Math.pow` being unremarkable outside the kernel.
 *
 * @throws on a NaN rather than writing the 0 the cast would produce. A black
 *         pixel in a map is a plausible reading of a mare floor, so a NaN that
 *         quantised silently would be found — if at all — as an unexplained dark
 *         patch long after the run that produced it.
 */
export function encodeChannel(linear: number): number {
  if (linear !== linear) {
    throw new RangeError(
      'a colour channel is NaN and would silently quantise to 0; a palette input was not finite',
    );
  }
  const c = linear < 0 ? 0 : linear > 1 ? 1 : linear;
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

/**
 * The inverse of {@link encodeChannel}, for tests and for anything reading a
 * rendered map back.
 */
export function decodeChannel(byte: number): number {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Write one linear RGB triple into a raster's byte buffer at `at`. */
export function writeLinearRgb(
  data: Uint8Array,
  at: number,
  r: number,
  g: number,
  b: number,
): void {
  data[at] = encodeChannel(r);
  data[at + 1] = encodeChannel(g);
  data[at + 2] = encodeChannel(b);
}
