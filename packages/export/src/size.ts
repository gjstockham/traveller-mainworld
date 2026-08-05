/**
 * Image dimensions, and the two R24 names for them.
 *
 * Its own module because both the projections and the renderer need the type and
 * neither should have to import the other to get it.
 */

/** Output dimensions in pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The two reference sizes R24 names, by the shorter names a user types.
 *
 * Equirectangular reference sizes, and 2:1 for the reason equirectangular maps
 * always are: the geographic domain is 360° by 180°, so a 2:1 raster is the one
 * whose texels are square at the equator. Nothing forbids another aspect —
 * {@link parseSize} accepts any — but a 1:1 equirectangular map has texels twice
 * as tall as they are wide at the equator, and its detail depth comes out of
 * {@link Projection.finestSpacingRad} accordingly rather than being wrong.
 */
export const REFERENCE_SIZES: Readonly<Record<string, ImageSize>> = Object.freeze({
  '2048x1024': { width: 2048, height: 1024 },
  '4096x2048': { width: 4096, height: 2048 },
});

/** Largest dimension accepted, in pixels. */
const MAX_DIMENSION = 16384;

/**
 * Parse a `WIDTHxHEIGHT` string.
 *
 * @throws naming what was wrong with it. An export is minutes of work; failing
 *         on the argument rather than after the render is the difference between
 *         a typo and a wasted afternoon.
 */
export function parseSize(text: string): ImageSize {
  const match = /^(\d+)[x×](\d+)$/.exec(text.trim());
  if (match === null) {
    throw new Error(
      `'${text}' is not a size. Write it as WIDTHxHEIGHT, for example ` +
        `${Object.keys(REFERENCE_SIZES).join(' or ')}.`,
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  for (const [name, value] of [['width', width], ['height', height]] as const) {
    if (value < 1 || value > MAX_DIMENSION) {
      throw new Error(
        `${name} ${String(value)} is outside 1..${String(MAX_DIMENSION)} pixels.`,
      );
    }
  }
  return { width, height };
}

/** `WIDTHxHEIGHT`, the spelling {@link parseSize} accepts. */
export function formatSize(size: ImageSize): string {
  return `${String(size.width)}x${String(size.height)}`;
}
