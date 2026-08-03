/**
 * @traveller-mainworld/core — headless deterministic world generation.
 *
 * No rendering dependencies (PRD R9): this package must stay consumable from
 * the viewer, from Node scripts, and from future suite tools alike.
 */

/**
 * Generator version, embedded in share URLs, exports and golden hashes (PRD R14).
 * Any change that alters generated output for any input must bump this in the
 * same PR as the regenerated golden manifest — see the change protocol in
 * docs/plans/phase0-implementation-plan.md §7.4.
 */
export const GEN_VERSION = '0.1.0';

// Kernel — the whitelisted zone. See README for what may and may not go in here.
export * from './kernel/ops.js';
export * from './kernel/hash.js';
export * from './kernel/rng.js';
export * from './kernel/approx.js';
export * from './kernel/noise.js';
export * from './kernel/fbm.js';
export * from './kernel/tileid.js';
export * from './kernel/cubesphere.js';

// Generation surface.
export type { PhysicalWorldSpec, World } from './spec.js';
export * from './tile/generator.js';

// Verification.
export * from './digest/index.js';
