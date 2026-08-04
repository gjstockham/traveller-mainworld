import type { PhysicalWorldSpec } from '@traveller-mainworld/core';

/**
 * How much to exaggerate terrain relief for display.
 *
 * True relief is invisible at planetary scale — Earth's entire range, Marianas
 * to Everest, is 0.31% of its radius — so every planet renderer exaggerates.
 * This one used a flat 30× multiplier, which was fine because it was only ever
 * pointed at one hardcoded world.
 *
 * Across the fixture set it is not fine. Relief-to-radius spans a factor of
 * eight, so a flat multiplier spans the same factor in *displayed* relief: the
 * large worlds looked like planets and the small ones like Vesta. Real bodies
 * do not work that way. The hydrostatic-equilibrium threshold sits near 200-300
 * km of radius, well below Cepheus Size 1, so every world this product renders
 * should be visibly round. Only Size 0 — a separate generator, explicitly out of
 * scope — is potato territory.
 *
 * So the exaggeration compresses rather than flattens. Displayed relief follows
 * the **square root** of true relief-to-radius, anchored so an Earth-like world
 * shows {@link DISPLAY_RELIEF_AT_REFERENCE} of its radius:
 *
 * ```
 * displayed = DISPLAY_RELIEF_AT_REFERENCE · √(ratio / REFERENCE_RATIO)
 * ```
 *
 * A flat multiplier would keep the differences and the potatoes. A constant
 * displayed relief would fix the potatoes and throw the differences away, which
 * would contradict the PRD's requirement that Size be *visibly* legible (§6.2:
 * "Size 8+: subdued relief relative to radius"). The square root keeps a rougher
 * small world rougher — about 3× across the set instead of 8× — while nothing
 * ends up non-spherical.
 *
 * At the anchor this yields roughly the old 30×, so an Earth-like world looks
 * as it always did.
 *
 * **This is a display choice and cannot reach a golden hash.** Elevation data
 * is generated in metres by `core` and scaled here, in the renderer, on its way
 * to a vertex buffer.
 */

/**
 * The anchor: 20 km of relief on a 6400 km radius, i.e. 0.3125%.
 *
 * That is `size8-earthlike` exactly, and Earth to two significant figures —
 * Earth's own figure is 0.314% (20 km on 6371 km). The round number is chosen
 * so the constant is exact rather than a truncated measurement.
 */
export const REFERENCE_RELIEF_RATIO = 0.003125;

/** Displayed peak-to-trough relief, as a fraction of radius, at the anchor. */
export const DISPLAY_RELIEF_AT_REFERENCE = 0.1;

/** True peak-to-trough relief as a fraction of radius. */
export function reliefRatio(spec: PhysicalWorldSpec): number {
  return spec.terrainAmplitudeM / (spec.radiusKm * 1000);
}

/** Displayed peak-to-trough relief, as a fraction of radius. */
export function displayedReliefFraction(spec: PhysicalWorldSpec): number {
  const ratio = reliefRatio(spec);
  if (ratio <= 0) {
    return 0;
  }
  return DISPLAY_RELIEF_AT_REFERENCE * Math.sqrt(ratio / REFERENCE_RELIEF_RATIO);
}

/**
 * Metres of generated elevation to scene units, with the planet radius as 1.
 *
 * This is what the tile mesh multiplies raw elevation by, and what skirt depth
 * is derived from.
 */
export function elevationScaleFor(spec: PhysicalWorldSpec): number {
  if (spec.terrainAmplitudeM <= 0) {
    return 0;
  }
  return displayedReliefFraction(spec) / spec.terrainAmplitudeM;
}

/** The effective multiplier, for the diagnostics overlay and for tests. */
export function effectiveExaggeration(spec: PhysicalWorldSpec): number {
  const ratio = reliefRatio(spec);
  return ratio <= 0 ? 0 : displayedReliefFraction(spec) / ratio;
}
