/**
 * Latitude and longitude, and the direction on the unit sphere they name.
 *
 * ## This file is outside the whitelisted zone, and so is the whole package
 *
 * `packages/core/src/kernel` may use only operations that are bit-identical
 * across JS engines, because everything it produces reaches a golden hash.
 * **Nothing here does.** A projection decides *which directions to sample*; the
 * sampling itself happens in the kernel, through `sampleSurface`, and comes back
 * bit-identical whatever route asked for it. Perturbing `Math.sin` in the last
 * bit here moves a sample by a picometre — it does not change what the world is.
 *
 * So `Math.sin`, `Math.cos`, `Math.log`, `Math.tan` and `Math.atan` are
 * unremarkable in this package, exactly as `Math.pow` is unremarkable in
 * `core/palette`. The boundary is easy to get wrong in both directions, which is
 * why it is written down here, in `core/palette`'s header, and in the README:
 * **if the value can move a hash it belongs in `kernel/`, and if it cannot it
 * does not.** The failure that costs the most is the second direction — a reader
 * who takes the whitelist to govern everything will import an approximation
 * *into* the kernel to satisfy a rule that never applied to the file they were
 * editing.
 *
 * ## The frame
 *
 * `+y` is the north pole and longitude is measured from `+z` toward `+x`. That
 * is not a free choice: it is the frame `OrbitCamera` and `render/sun.ts`
 * already use, and cube-sphere face 2 is `+y`. A map whose north was `+z` would
 * be a correct map of a rotated planet, which is the worst kind of wrong.
 *
 * ## What a pole is
 *
 * A pole is **a value, not a limit**, and this file is where that is decided.
 *
 * At `lat = ±90°` the `cos(lat)` factor kills the longitude term, so every
 * longitude names the same point — in exact arithmetic. In doubles it does not:
 * `Math.cos(Math.PI / 2)` is `6.12e-17` rather than zero, so a row of samples
 * taken across a pole comes back as a ring of points 6e-17 apart, each hashing
 * into a different lattice cell in the deepest crater bands. Whether that shows
 * as a row of identical pixels or a row of subtly different ones would then
 * depend on nothing more principled than how the arithmetic was arranged.
 *
 * {@link directionFromGeographic} therefore **returns the pole axis exactly**
 * for `|lat| >= π/2` — an exact comparison, not a tolerance — so a pole pixel is
 * one defined direction and a whole row of them is one colour. `geography.test.ts`
 * asserts both halves: that the axis is exact, and that it does not depend on
 * longitude.
 *
 * The second half of the decision is in `equirectangular.ts`, which samples
 * **pixel centres** and so never asks for a pole at all. The two are independent
 * on purpose: the projection's grid makes the degenerate case unreachable by
 * default, and this function makes it defined for the caller who reaches it
 * anyway — a `?lat=90` in some future tool, or a projection whose grid is
 * registered the other way.
 */

/** A quarter turn. The pole latitude, and the half-height of the geographic domain. */
export const HALF_PI = Math.PI / 2;

/** A full turn. The width of the longitude domain. */
export const TWO_PI = Math.PI * 2;

/** Radians per degree. */
export const DEG = Math.PI / 180;

/**
 * The unit direction at a geographic position, written into `out` at `at`.
 *
 * `+y` north, longitude from `+z` toward `+x` — see the module header for why
 * that frame and not another. Latitude beyond `±π/2` is not wrapped: it is
 * clamped to the pole, because a projection that produced one has a bug the
 * caller should see as a flat polar cap rather than as a mirrored hemisphere.
 */
export function directionFromGeographic(
  latRad: number,
  lonRad: number,
  out: Float64Array,
  at = 0,
): void {
  // The exact comparisons the module header argues for. Not `Math.abs(lat) >=
  // HALF_PI` in one branch, because that would lose which pole it was.
  if (latRad >= HALF_PI) {
    out[at] = 0;
    out[at + 1] = 1;
    out[at + 2] = 0;
    return;
  }
  if (latRad <= -HALF_PI) {
    out[at] = 0;
    out[at + 1] = -1;
    out[at + 2] = 0;
    return;
  }

  const c = Math.cos(latRad);
  out[at] = c * Math.sin(lonRad);
  out[at + 1] = Math.sin(latRad);
  out[at + 2] = c * Math.cos(lonRad);
}

/**
 * The geographic position of a unit direction — the inverse of
 * {@link directionFromGeographic}.
 *
 * For tests, for the graticule's labels, and for anything that needs to say
 * where on the map a 3D position landed. Longitude at a pole is arbitrary and
 * comes back as 0; a round trip through both functions is therefore exact in
 * direction and not in longitude, which is a property of the sphere and not of
 * this code.
 *
 * @param out `[latRad, lonRad]`.
 */
export function geographicFromDirection(
  x: number,
  y: number,
  z: number,
  out: Float64Array,
  at = 0,
): void {
  const clamped = y > 1 ? 1 : y < -1 ? -1 : y;
  out[at] = Math.asin(clamped);
  out[at + 1] = x === 0 && z === 0 ? 0 : Math.atan2(x, z);
}

/**
 * Axis-aligned bounding box of every direction in a latitude band, written into
 * `out` as `[minX, minY, minZ, maxX, maxY, maxZ]`.
 *
 * Both MVP projections send an output *row* to a band of latitude spanning every
 * longitude, so this is what the basin cull is built against — the export's
 * counterpart of `tilegen.ts`'s per-row box, and the reason the `cull` argument
 * on `sampleSurface` exists.
 *
 * **A loose box is safe and a wrong one is not.** `BasinCull` is documented as a
 * superset filter: a basin it keeps but which cannot reach a particular sample
 * is dropped by the same exact early-out as everything else, so culling loosely,
 * tightly, or not at all gives bit-identical results — `craters.test.ts` asserts
 * exactly that, naming this caller. What must never happen is a box that
 * *excludes* a basin which can reach a sample, so the band's own latitudes are
 * expanded to the pixel edges by the caller before they arrive here.
 */
export function latitudeBandBounds(
  latMinRad: number,
  latMaxRad: number,
  out: Float64Array,
): void {
  const lo = Math.min(latMinRad, latMaxRad);
  const hi = Math.max(latMinRad, latMaxRad);

  // The horizontal extent is `cos` of whichever latitude in the band is nearest
  // the equator — and the whole of it when the band straddles the equator, where
  // `cos` peaks inside the band rather than at an end.
  const horizontal = lo <= 0 && hi >= 0 ? 1 : Math.max(Math.cos(lo), Math.cos(hi));

  out[0] = -horizontal;
  out[1] = Math.sin(lo);
  out[2] = -horizontal;
  out[3] = horizontal;
  out[4] = Math.sin(hi);
  out[5] = horizontal;
}
