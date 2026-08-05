/**
 * The graticule (R25): meridians and parallels at 15°, emphasised at 30°.
 *
 * ## Drawn by crossing detection, not by line drawing
 *
 * The obvious implementation projects each graticule line forward and rasterises
 * it. That needs a *forward* projection, which is the direction this package
 * deliberately does not have — see `projection/projection.ts` for why the
 * interface is inverse-only, and what it costs (a Winkel tripel inverse is a
 * Newton iteration) versus what it buys.
 *
 * Instead: a pixel lies on a meridian when its longitude and its left
 * neighbour's fall in different 15° cells. That is one comparison per pixel, it
 * produces a one-pixel line wherever the line actually is, and it is **the same
 * code for every projection** — a curved graticule falls out of a curved
 * projection with nothing added. The same trick draws parallels against the
 * pixel above.
 *
 * Two consequences worth stating rather than discovering:
 *
 * - **The lines are exactly one pixel wide** wherever the projection is
 *   monotonic in that axis, which both MVP projections are. Where a projection
 *   compresses hard — Mercator near its clip, where several degrees of latitude
 *   share a row — two parallels can land on one pixel and the crossing fires
 *   once. That is the honest rendering of "these lines are closer together than
 *   your resolution", and it is better than a drawn line that would claim
 *   otherwise.
 * - **The antimeridian is not a line.** Column 0's left neighbour is off the
 *   map, so nothing is compared, and the ±180° meridian falls on the map's own
 *   edge where a line would be invisible anyway. `graticule.test.ts` asserts the
 *   meridian count with that in mind rather than expecting one more.
 *
 * ## Why 15 and 30
 *
 * Plan §8 and R25 both say "15°/30°". Read as one graticule at 15° with every
 * second line — the 30° multiples, which include the equator and the prime
 * meridian — drawn stronger, so the map has a readable coarse structure without
 * a second density of lines. The tropics and the polar circles are not drawn:
 * they are Earth's, and this is not Earth.
 */
import { DEG } from '../geography.js';
import type { Projection } from '../projection/projection.js';
import type { Raster } from '../raster.js';
import type { ImageSize } from '../size.js';
import { type Ink, blend } from './draw.js';

/** Minor graticule interval, in degrees. */
export const MINOR_STEP_DEG = 15;
/** Major graticule interval, in degrees. Drawn stronger. */
export const MAJOR_STEP_DEG = 30;

/** Graticule ink. Near-white: airless regolith is pale, so a black line would vanish in ejecta. */
const INK: Ink = [235, 240, 248];
/** Opacity of a 15° line. */
const MINOR_ALPHA = 0.22;
/** Opacity of a 30° line. */
const MAJOR_ALPHA = 0.45;

/**
 * Which 15° cell a coordinate falls in.
 *
 * `floor` rather than `round`, so the cell boundary — the graticule line itself
 * — is where the value changes. Using `round` would put the change half a cell
 * away from the line, which is a bug that looks like an off-by-one in the map
 * projection and is not.
 */
function cell(radians: number): number {
  return Math.floor(radians / DEG / MINOR_STEP_DEG);
}

/** Is the boundary between cells `a` and `a+1` a major (30°) line? */
function isMajorBoundary(higher: number): boolean {
  // The boundary above cell `c` sits at `(c+1)·15°`, and is major when that is a
  // multiple of 30 — that is, when `c+1` is even.
  return higher % (MAJOR_STEP_DEG / MINOR_STEP_DEG) === 0;
}

/**
 * Draw the graticule over a rendered raster.
 *
 * Runs as a second pass rather than inside the sampling loop, which costs one
 * more walk over the image and no more sampling — the expensive thing in an
 * export is `sampleSurface`, and this pass calls it not at all. It keeps the
 * sampling loop free of overlay concerns, which is what lets a worker render a
 * band without knowing whether a graticule was asked for.
 */
export function drawGraticule(raster: Raster, projection: Projection): void {
  const size: ImageSize = { width: raster.width, height: raster.height };
  const here = new Float64Array(2);
  const left = new Float64Array(2);
  const above = new Float64Array(2);

  for (let py = 0; py < raster.height; py++) {
    for (let px = 0; px < raster.width; px++) {
      if (!projection.pixelToGeographic(size, px, py, here)) {
        continue;
      }

      // Meridian: this pixel's longitude cell against its left neighbour's.
      if (px > 0 && projection.pixelToGeographic(size, px - 1, py, left)) {
        const a = cell(left[1]!);
        const b = cell(here[1]!);
        if (a !== b) {
          const higher = Math.max(a, b);
          blend(
            raster.data, raster.width, raster.height, px, py, INK,
            isMajorBoundary(higher) ? MAJOR_ALPHA : MINOR_ALPHA,
          );
        }
      }

      // Parallel: against the pixel above. Latitude decreases downward in both
      // MVP projections, so the boundary crossed is the *higher* cell index,
      // which is the one `above` holds.
      if (py > 0 && projection.pixelToGeographic(size, px, py - 1, above)) {
        const a = cell(above[0]!);
        const b = cell(here[0]!);
        if (a !== b) {
          const higher = Math.max(a, b);
          blend(
            raster.data, raster.width, raster.height, px, py, INK,
            isMajorBoundary(higher) ? MAJOR_ALPHA : MINOR_ALPHA,
          );
        }
      }
    }
  }
}
