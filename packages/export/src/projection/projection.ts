/**
 * The projection interface (PRD R23).
 *
 * ## Inverse, not forward, and that is the whole shape of it
 *
 * A raster export walks output pixels and asks each one where it is on the
 * planet. So the operation every projection must supply is the **inverse**:
 * pixel → geographic. Nothing in this package ever needs the forward direction,
 * including the graticule — `overlay/graticule.ts` finds a meridian by noticing
 * that two adjacent pixels fall either side of one, which works for any
 * projection whose inverse exists and needs no per-projection line-drawing code.
 *
 * That is the interface R23's "makes Winkel tripel and azimuthal cheap later"
 * has to be read against, and it is worth being honest about which way it cuts.
 * Azimuthal projections invert in closed form and are a file each. **Winkel
 * tripel does not** — its forward map is closed-form and its inverse needs a
 * two-dimensional Newton iteration. That is still cheap *here*, because it is
 * twenty lines behind {@link Projection.pixelToGeographic} and nothing else in
 * the package changes; it would not have been cheap behind a forward-facing
 * interface, which would have made every consumer resample.
 *
 * ## Rows are latitude bands, and the renderer relies on it
 *
 * Both MVP projections send an output row to a band of latitude spanning every
 * longitude. {@link Projection.rowBandBounds} is where a projection states that
 * — it is what the basin cull is built from, and it is allowed to be loose (see
 * `latitudeBandBounds`). A projection for which rows are *not* latitude bands
 * (an oblique aspect, say) simply returns the whole sphere and pays for it in
 * time rather than in correctness.
 *
 * ## Pixel centres
 *
 * Every projection in this package samples **pixel centres**: pixel `(px, py)`
 * covers the half-open square `[px, px+1) × [py, py+1)` of projection plane and
 * is sampled at `(px + 0.5, py + 0.5)`. This is area registration, the
 * convention every equirectangular raster in the wild uses, and it is what makes
 * the polar singularity unreachable rather than special-cased — see
 * `equirectangular.ts`.
 */
import type { ImageSize } from '../size.js';

/**
 * A map projection, as its inverse plus what a title block has to say about it.
 *
 * Implementations are immutable value objects. A projection carrying parameters
 * — Mercator's clip latitude — is a *different instance*, not a mutated one, so
 * that the title block and the renderer cannot be looking at different settings.
 */
export interface Projection {
  /** Stable identifier, for URLs, the CLI and the registry. */
  readonly id: string;
  /** Display name for the title block. */
  readonly name: string;

  /**
   * The projection's own parameters, as title-block rows.
   *
   * Empty for a projection that has none. Mercator's clip goes here rather than
   * being left implicit, because a map that silently loses the poles is a map
   * somebody will misread (plan §8).
   */
  parameterLines(): readonly string[];

  /**
   * The finest angular sample spacing anywhere in the image, in radians.
   *
   * What {@link detailDepthFor} matches a tile depth against. "Finest" rather
   * than "typical": choosing the depth from the *average* texel would leave the
   * most densely sampled part of the map — the equator, in both MVP projections
   * — asking for detail the chosen depth does not carry, which is aliasing that
   * a reader would blame on the generator.
   */
  finestSpacingRad(size: ImageSize): number;

  /**
   * Where the centre of pixel `(px, py)` is on the planet.
   *
   * @param out Receives `[latRad, lonRad]`.
   * @returns `false` when the pixel lies outside the projected world — Mercator's
   *          clipped polar caps. A false return leaves `out` untouched and the
   *          renderer fills the pixel with {@link OUTSIDE_COLOUR} rather than
   *          guessing; a projection that silently clamped instead would smear
   *          the clip latitude across the whole cap and call it terrain.
   */
  pixelToGeographic(size: ImageSize, px: number, py: number, out: Float64Array): boolean;

  /**
   * Bounding box on the unit sphere of every direction rows `[row0, row0+rows)`
   * can produce, as `[minX, minY, minZ, maxX, maxY, maxZ]`.
   *
   * May be loose; must never be tight enough to exclude a direction the band
   * actually samples. See `latitudeBandBounds`.
   */
  rowBandBounds(size: ImageSize, row0: number, rows: number, out: Float64Array): void;
}

/**
 * What a pixel outside the projected world is filled with.
 *
 * Mercator's clip leaves two caps with no planet in them. They are painted a
 * flat neutral rather than left at zero, because a black cap next to a dark mare
 * reads as terrain and a mid-grey one reads as paper. It is the only colour in
 * this package that does not come out of `core/palette`, and it is deliberately
 * not a colour any surface can produce.
 */
export const OUTSIDE_COLOUR: readonly [number, number, number] = [0.42, 0.44, 0.47];
