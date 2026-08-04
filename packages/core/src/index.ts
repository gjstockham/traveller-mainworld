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

// The input layer (PRD §6.1) — UPP parsing and seed handling. Feeds the ruleset
// interpreter rather than the kernel: nothing here reaches a golden hash.
export * from './input/index.js';

// Generation surface.
export type { PhysicalWorldSpec, World } from './spec.js';
// The fixture worlds. Here rather than in the golden harness so that the worlds
// the viewer can fly and the worlds the manifest pins are the same objects.
export * from './fixtures.js';
export * from './tile/generator.js';

// The WASM kernel twin (WP3). Marshalling only — no generation arithmetic — so
// it sits outside the whitelisted zone. Loading the module is the caller's job,
// which keeps this import free of any Node or browser specifics.
export * from './wasm/kernel.js';
export * from './wasm/generator.js';

// Verification.
export * from './digest/index.js';
