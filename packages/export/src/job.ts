/**
 * What one export is: a world, a projection, a size, a depth, and what the title
 * block says.
 *
 * Deliberately **plain data**. An `ExportJob` is what crosses the worker
 * boundary in `pool/protocol.ts`, so it has to be structured-cloneable — no
 * class instances, no functions, no `Projection` object. The projection travels
 * as its id plus its options and is rebuilt on the far side through
 * `requireProjection`, which is also what makes a job round-trip through a URL
 * or a CLI argument list without a second spelling of it.
 */
import type { PointSampleInput } from '@traveller-mainworld/core';

import type { ProjectionOptions } from './projection/index.js';
import type { ImageSize } from './size.js';

/** The identity a title block states (R25), as strings, already decided. */
export interface ExportIdentity {
  /** Canonical UPP, or undefined on the fixture route. */
  readonly upp: string | undefined;
  /** Fixture id, or undefined on the UPP route. */
  readonly fixtureId: string | undefined;
  /** The seed as typed and shared. */
  readonly seedText: string | undefined;
  /** `GEN_VERSION` of the build that produced the map. */
  readonly genVersion: string;
  /** Ruleset id, or undefined where no ruleset was consulted. */
  readonly rulesetId: string | undefined;
  readonly rulesetName: string | undefined;
  readonly radiusKm: number;
  /**
   * The reduced-fidelity summary, if any (R25 by extension of R21).
   *
   * **Not in plan §8's list, and it belongs on the map.** `WorldChoice` already
   * carries a `FidelityReport`; an export of a badged world that does not say so
   * is a picture of a dry Hydro-7 world with nothing on it to explain why, and
   * the missing ocean gets filed as a bug against the exporter. One line.
   */
  readonly fidelity: string | undefined;
}

/** Everything one export needs. Structured-cloneable throughout. */
export interface ExportJob {
  readonly size: ImageSize;
  readonly projectionId: string;
  readonly projectionOptions: ProjectionOptions;
  /**
   * Tile depth the surface is sampled at.
   *
   * Resolved before the job is built — see `detailDepthFor`. Carried as a number
   * rather than derived per worker so that every band of one map is sampled at
   * the same depth even if the derivation later changes.
   */
  readonly depth: number;
  /** Whether {@link depth} came from the formula or from the user. Title block only. */
  readonly depthChosen: boolean;
  /** The world, in the shape `sampleSurface` takes. */
  readonly input: PointSampleInput;
  /** World seed lanes, for `worldPalette`. Already inside `input`; named again for clarity. */
  readonly seedHi: number;
  readonly seedLo: number;
  readonly identity: ExportIdentity;
  /** Draw the graticule (R25). */
  readonly graticule: boolean;
  /** Draw the title block (R25). */
  readonly titleBlock: boolean;
}

/** Turn a `World` into the `PointSampleInput` both sampling paths share. */
export function pointInputFor(world: {
  readonly seedHi: number;
  readonly seedLo: number;
  readonly spec: {
    readonly fbm: PointSampleInput['fbm'];
    readonly terrainAmplitudeM: number;
    readonly radiusKm: number;
    readonly craters: {
      readonly densityScale: number;
      readonly transitionDiameterKm: number;
      readonly regolithMaturity: number;
    };
  };
}): PointSampleInput {
  return {
    seedHi: world.seedHi,
    seedLo: world.seedLo,
    fbm: world.spec.fbm,
    amplitudeM: world.spec.terrainAmplitudeM,
    radiusKm: world.spec.radiusKm,
    craterDensityScale: world.spec.craters.densityScale,
    craterTransitionDiameterKm: world.spec.craters.transitionDiameterKm,
    regolithMaturity: world.spec.craters.regolithMaturity,
  };
}
