/**
 * The physical description of a world, as consumed by the generator.
 *
 * From Phase 1 this is produced by the ruleset interpreter — a pure function
 * `(UPP, ruleset) → PhysicalWorldSpec` holding all rules knowledge, so the
 * generator downstream knows nothing about UPPs (PRD §6.2). Phase 0 has no
 * interpreter yet, so specs are hand-written; the fields here are the subset
 * Phase 0 actually uses, and will grow rather than change shape.
 */
import type { FbmParams } from './kernel/fbm.js';

export interface PhysicalWorldSpec {
  /** Planetary radius in kilometres (PRD R5). */
  readonly radiusKm: number;
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
