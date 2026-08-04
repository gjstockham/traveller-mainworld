import type { PhysicalWorldSpec } from '@traveller-mainworld/core';

/**
 * How much to exaggerate terrain relief for display. By default: not at all.
 *
 * Real planets are, geometrically, spheres. Earth's entire topographic range —
 * Marianas Trench to Everest — is 0.31% of its radius, and a photograph from
 * orbit shows a perfectly circular limb. Everything visible on Luna or Mars from
 * space comes from albedo and from shading at low sun angles, not from a
 * silhouette that departs from a circle. A renderer that displaces geometry
 * enough to be obvious has stopped looking like a photograph and started looking
 * like a relief globe.
 *
 * This viewer used a flat 30×, then briefly a square-root compression anchored
 * at 3.5% of radius. Both were attempts to make terrain legible through
 * geometry, and both make a large world look rockier than it is — the opposite
 * of the goal. So the default is now **1×: true scale**.
 *
 * The consequence is worth stating plainly rather than discovering: at true
 * scale these worlds are nearly featureless. Almost everything currently visible
 * on them is displacement, because the things that give a real body its face
 * have not been built yet — craters (Phase 1), albedo tracking geology rather
 * than elevation bands (Phase 4), and shading computed from the true elevation
 * gradient at full resolution. Photorealism is those, not a multiplier.
 *
 * `?exaggeration=<n>` overrides it, for looking at terrain that true scale
 * hides. That is an inspection tool, not a display default.
 *
 * **This is a display choice and cannot reach a golden hash.** Elevation is
 * generated in metres by `core` and scaled here, on its way to a vertex buffer.
 */

/** True scale. A photograph of a planet has no vertical exaggeration. */
export const DEFAULT_EXAGGERATION = 1;

/** Guard rail for `?exaggeration=`; the mesh self-intersects well before this. */
export const MAX_EXAGGERATION = 200;

/** True peak-to-trough relief as a fraction of radius. */
export function reliefRatio(spec: PhysicalWorldSpec): number {
  return spec.terrainAmplitudeM / (spec.radiusKm * 1000);
}

/** Displayed peak-to-trough relief, as a fraction of radius. */
export function displayedReliefFraction(
  spec: PhysicalWorldSpec,
  exaggeration = DEFAULT_EXAGGERATION,
): number {
  return reliefRatio(spec) * exaggeration;
}

/**
 * Metres of generated elevation to scene units, with the planet radius as 1.
 *
 * This is what the tile mesh multiplies raw elevation by, and what skirt depth
 * derives from — so at true scale the skirts shrink with it, which is right: a
 * crack between LOD levels is proportional to the displacement that opens it.
 */
export function elevationScaleFor(
  spec: PhysicalWorldSpec,
  exaggeration = DEFAULT_EXAGGERATION,
): number {
  if (spec.radiusKm <= 0) {
    return 0;
  }
  return exaggeration / (spec.radiusKm * 1000);
}

/**
 * Read `?exaggeration=` from a query string.
 *
 * Nothing is rejected silently: a value that is not a positive finite number, or
 * is beyond {@link MAX_EXAGGERATION}, throws rather than being quietly clamped,
 * because a silently-ignored display override is how someone concludes the
 * terrain is flat when they simply mistyped.
 */
export function exaggerationFrom(params: URLSearchParams): number {
  const raw = params.get('exaggeration');
  if (raw === null) {
    return DEFAULT_EXAGGERATION;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`?exaggeration=${raw} must be a positive number`);
  }
  if (value > MAX_EXAGGERATION) {
    throw new Error(
      `?exaggeration=${raw} exceeds ${String(MAX_EXAGGERATION)}; the mesh self-intersects long before that`,
    );
  }
  return value;
}
