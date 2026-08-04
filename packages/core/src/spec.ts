/**
 * The physical description of a world, as consumed by the generator.
 *
 * This is the interface PRD R7 asks to be "documented and versioned so
 * alternative rulesets can be added without touching the generator or viewer".
 * It is the contract between the ruleset interpreter — `(UPP, ruleset) →
 * PhysicalWorldSpec`, which holds *all* rules knowledge — and everything
 * downstream, which holds none. Nothing here mentions a UPP, a code, or
 * Cepheus, and nothing here should ever start to.
 *
 * ## Why the whole R5 field set arrives at once
 *
 * Most of these fields have no consumer yet. `hydrographicCoverage` waits for
 * Phase 2's sea-level solve (R8), `atmosphere` for Phase 2's sky, `hints` for
 * Phase 4's climate classifier. They are here anyway, because a field that
 * arrives in Phase 2 arrives with a fixture-hash change attached, and paying
 * that once is cheaper than paying it four times.
 *
 * ## Every field here must be finite
 *
 * From WP14 the golden fixtures hash the interpreted spec, and from WP10 the
 * crater parameters reach tile generation. NaN bit patterns are unspecified in
 * both JS and WASM, so one NaN anywhere below makes a hash unreproducible —
 * and a divide by a zero radius or a zero gravity is the realistic way to get
 * one. `packages/core/test/interpret.test.ts` asserts finiteness across every
 * valid UPP for exactly this reason.
 */
import type { FbmParams } from './kernel/fbm.js';

/**
 * How much atmosphere there is, independent of what it is made of.
 *
 * Deliberately coarse. The renderer needs to know whether to draw a sky, a
 * haze or nothing; it does not need a millibar figure, and
 * {@link AtmosphereSpec.pressureBar} carries one for anything that does.
 */
export type PressureBand =
  | 'none'
  | 'trace'
  | 'very-thin'
  | 'thin'
  | 'standard'
  | 'dense'
  | 'unusual';

/**
 * What the atmosphere is made of, to the resolution the renderer cares about.
 *
 * `tainted` is chemically ordinary but not breathable unfiltered; `exotic`,
 * `corrosive` and `insidious` are the three distinct hazard classes, and they
 * are kept apart because they tint a surface differently (PRD §6.2's
 * illustrative mapping: "B–C corrosive: chemically stained surfaces").
 */
export type CompositionClass =
  | 'none'
  | 'standard'
  | 'tainted'
  | 'exotic'
  | 'corrosive'
  | 'insidious'
  | 'unusual';

/**
 * A coarse thermal regime.
 *
 * `extreme` is not a temperature but the *absence* of one: a body with no
 * atmosphere has no heat transport, so its day side and night side are
 * hundreds of kelvin apart and no single band describes it.
 *
 * A UPP does not encode orbital distance, so this can only ever be a hint —
 * PRD R5 calls it one. Phase 4 replaces it with a real classifier over
 * latitude insolation, lapse rate and greenhouse offset.
 */
export type TemperatureBand = 'extreme' | 'cold' | 'temperate' | 'hot';

/** Atmospheric properties (PRD R5: "pressure band and composition class"). */
export interface AtmosphereSpec {
  readonly pressureBand: PressureBand;
  /**
   * Representative surface pressure in bar; zero for a vacuum.
   *
   * One number standing for a band that is really a range, because the things
   * that will consume it — haze density, scattering strength, ablation of
   * small impactors — want a scalar and not an interval.
   */
  readonly pressureBar: number;
  readonly composition: CompositionClass;
}

/** PRD R5's "derived hints": not measurements, and never treated as any. */
export interface DerivedHints {
  readonly temperatureBand: TemperatureBand;
  /** Probability-ish scalar in `[0, 1]` that the world carries surface ice. */
  readonly iceLikelihood: number;
  /**
   * Relief as a fraction of radius — `terrainAmplitudeM / (radiusKm · 1000)`.
   *
   * The dimensionless number that actually decides how rough a world reads.
   * Earth is 0.0031; a Size 1 rockball around 0.018. Derived rather than
   * independent, and named because "0.3% of radius" is the figure a human
   * reasons with and `20000 / 6400000` is not.
   */
  readonly terrainRoughness: number;
}

/**
 * Crater-field parameters (Phase 1 plan §4.1).
 *
 * Spec fields rather than kernel constants, because they are a large part of
 * what makes a Size 1 rockball and a Size A world look like different places.
 */
export interface CraterSpec {
  /**
   * Crater density relative to a saturated airless surface, in `[0, 1]`.
   *
   * 1.0 is "as cratered as a surface can get" — Luna's highlands. Erosion and
   * standing liquid drive it down.
   */
  readonly densityScale: number;
  /**
   * Diameter in km at which craters stop being simple bowls and start having
   * flat floors, terraced rims and central peaks.
   *
   * The first field on this spec that is a real *use* of surface gravity
   * rather than storage of it: the transition scales inversely with gravity,
   * so it is ~3 km on an Earth-sized world and ~64 km on a Size 1 body.
   */
  readonly transitionDiameterKm: number;
  /**
   * Maturity of the impact-gardened surface layer, in `[0, 1]`.
   *
   * 1.0 is a deep, thoroughly reworked regolith — Luna. Near zero is bare
   * rock or a surface resurfaced faster than gardening can rework it.
   */
  readonly regolithMaturity: number;
}

/**
 * The physical description of a world.
 *
 * Field order here is the order {@link module:ruleset/serialise} writes them
 * in; that serialisation is a committed identity from WP14, so reordering the
 * interface is not a cosmetic change.
 */
export interface PhysicalWorldSpec {
  /** Planetary radius in kilometres (PRD R5). */
  readonly radiusKm: number;
  /** Surface gravity in Earth gravities (PRD R5). */
  readonly surfaceGravityG: number;
  /** Atmosphere (PRD R5). */
  readonly atmosphere: AtmosphereSpec;
  /** Fraction of the surface covered by liquid, in `[0, 1]` (PRD R5, R8). */
  readonly hydrographicCoverage: number;
  /** Derived hints (PRD R5). Hints, not measurements. */
  readonly hints: DerivedHints;
  /** Crater-field parameters (Phase 1 plan §4.1). */
  readonly craters: CraterSpec;
  /** Peak-to-trough terrain relief in metres. */
  readonly terrainAmplitudeM: number;
  /** Base terrain field parameters. */
  readonly fbm: FbmParams;
}

/** A world: a physical spec plus the seed that instantiates it. */
export interface World {
  readonly spec: PhysicalWorldSpec;
  /** High 32 bits of the 64-bit world seed. */
  readonly seedHi: number;
  /** Low 32 bits of the 64-bit world seed. */
  readonly seedLo: number;
}
