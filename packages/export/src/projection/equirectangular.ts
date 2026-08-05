/**
 * Equirectangular (plate carrée) — the reference projection (R24).
 *
 * Longitude maps linearly to `x` and latitude linearly to `y`. It distorts area
 * badly toward the poles and is the standard interchange format anyway, because
 * it is the one a texture sampler, a wiki and a human all read without being
 * told anything.
 *
 * ## The pole, decided
 *
 * The plan's warning is that an equirectangular map sends an entire output row
 * to a single point on the sphere, where the direction is a limit rather than a
 * value. **That is true of grid registration and not of this file.**
 *
 * Pixel `py` covers latitudes `[90° − (py+1)·180/H, 90° − py·180/H]` and is
 * sampled at its **centre**, `90° − (py + 0.5)·180/H`. So:
 *
 * - **No row is ever at a pole.** The top row of a 2048-high map is sampled at
 *   89.956°, and `cos` of that is `7.7e-4` rather than zero. There is no limit
 *   to take and no singularity to arrange the arithmetic around.
 * - **The poles are inside the map, not on its edge.** The north pole sits on
 *   the top edge of row 0, which is exactly where a 180°-tall image should put
 *   it. Grid registration would instead put row 0's *centre* at the pole and
 *   give the map `H − 1` bands of latitude in `H` rows of pixels, so the first
 *   and last would be half-height — a subtly wrong map, in exchange for one
 *   uniform row.
 * - **It is the convention.** Area registration is what every equirectangular
 *   raster in circulation uses, so a reader who assumes it is right.
 *
 * The top row therefore does *vary*: its 4096 samples lie on a circle of radius
 * `7.7e-4` of the planetary radius — about 1.3 km on a Luna-sized world, some
 * three sample spacings at detail depth 4 — so it is a real, continuous, heavily
 * oversampled traverse and not a seam. `projection.test.ts` asserts the
 * continuity rather than an equality that is not true.
 *
 * The other half of the decision lives in `geography.ts`: a caller who asks for
 * `lat = ±90°` anyway gets the pole axis **exactly**, so a whole row of them is
 * one colour. This projection simply never asks.
 */
import { DEG, HALF_PI, TWO_PI, latitudeBandBounds } from '../geography.js';
import type { ImageSize } from '../size.js';
import type { Projection } from './projection.js';

/** The registry id. */
export const EQUIRECTANGULAR_ID = 'equirectangular';

/**
 * Latitude at the *top edge* of pixel row `py` — not its centre.
 *
 * The band boundary, which is what {@link Projection.rowBandBounds} needs and
 * what makes the basin cull a superset rather than a near-miss. `py = 0` gives
 * exactly `+π/2` and `py = height` exactly `−π/2`.
 */
function edgeLatitude(height: number, py: number): number {
  return HALF_PI - (py / height) * Math.PI;
}

class Equirectangular implements Projection {
  readonly id = EQUIRECTANGULAR_ID;
  // ASCII, and it took an `é` reaching `assertPrintable` on the very first
  // render to make the point: the display name goes on the map, the 5x7 font
  // draws ASCII 32-126, and "plate carrée" is not in it. The alternate name
  // lives in the module header, where an accent costs nothing.
  readonly name = 'Equirectangular';

  parameterLines(): readonly string[] {
    return [];
  }

  finestSpacingRad(size: ImageSize): number {
    // Longitude spans 2π over the width and latitude π over the height, and both
    // are at their finest in angular terms at the equator — where a degree of
    // longitude is a full degree of arc. The minimum of the two is what the
    // detail depth has to satisfy.
    return Math.min(TWO_PI / size.width, Math.PI / size.height);
  }

  pixelToGeographic(size: ImageSize, px: number, py: number, out: Float64Array): boolean {
    out[0] = HALF_PI - ((py + 0.5) / size.height) * Math.PI;
    out[1] = ((px + 0.5) / size.width) * TWO_PI - Math.PI;
    return true;
  }

  rowBandBounds(size: ImageSize, row0: number, rows: number, out: Float64Array): void {
    latitudeBandBounds(
      edgeLatitude(size.height, row0 + rows),
      edgeLatitude(size.height, row0),
      out,
    );
  }
}

const INSTANCE = new Equirectangular();

/** The equirectangular projection. Stateless, so one instance serves everybody. */
export function equirectangular(): Projection {
  return INSTANCE;
}

/**
 * Degrees of latitude and longitude per pixel — for evidence and for the CLI's
 * summary, not used in the render.
 */
export function equirectangularScaleDeg(size: ImageSize): { lat: number; lon: number } {
  return { lat: 180 / size.height, lon: 360 / size.width };
}

/** Latitude in degrees at the centre of pixel row `py`. For tests and evidence. */
export function equirectangularRowLatitudeDeg(size: ImageSize, py: number): number {
  return (HALF_PI - ((py + 0.5) / size.height) * Math.PI) / DEG;
}
