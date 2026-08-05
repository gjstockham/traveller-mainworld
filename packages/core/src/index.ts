/**
 * @traveller-mainworld/core — headless deterministic world generation.
 *
 * No rendering dependencies (PRD R9): this package must stay consumable from
 * the viewer, from Node scripts, and from future suite tools alike.
 */

/**
 * Generator version, embedded in share URLs, exports and golden hashes (PRD R14).
 * Any change that alters generated output for any input must bump this in the
 * same commit as the regenerated golden manifest — see the change protocol in
 * `CHANGELOG.md`, which is the copy of it that is in version control.
 *
 * ## Why this is a prerelease
 *
 * Phase 1's plan assigns `0.2.0` to WP14, at the end. That is right for the
 * final state and wrong for the six sessions in between: WP10 changes generated
 * output many times over, `golden:update` refuses to regenerate a manifest while
 * this string is unchanged (which is the gate working), and bumping
 * `0.2.0 → 0.2.1 → 0.2.2` per commit would mint a string of versions that never
 * existed for anyone.
 *
 * Prerelease identifiers instead, bumped once per re-pin rather than once per
 * commit. Semver-valid, usable as a cache key and a URL parameter, and the tag
 * says plainly that this was never emitted to a user — which is exactly the
 * property that makes the README's phantom-version objection not apply.
 * `0.2.0` proper lands when WP14 closes.
 *
 * Between re-pins `golden:verify:fixtures` is legitimately red. That is the
 * cost, and it is smaller than the alternative — developing behind a flag
 * defaulted off, which keeps the protocol quiet but means the fixture set is not
 * hashing what is being built, forfeiting the composition-bug catching it exists
 * for.
 */
export const GEN_VERSION = '0.2.0-alpha.1';

// Kernel — the whitelisted zone. See README for what may and may not go in here.
export * from './kernel/ops.js';
export * from './kernel/hash.js';
export * from './kernel/rng.js';
export * from './kernel/approx.js';
export * from './kernel/noise.js';
export * from './kernel/fbm.js';
export * from './kernel/tileid.js';
export * from './kernel/cubesphere.js';
export * from './kernel/craters.js';
export * from './kernel/tilegen.js';

// The input layer (PRD §6.1) — UPP parsing and seed handling. Feeds the ruleset
// interpreter rather than the kernel: nothing here reaches a golden hash.
export * from './input/index.js';

// The ruleset interpretation layer (PRD §6.2). Holds all rules knowledge, and
// is the only thing in this package that knows what a UPP means.
export * from './ruleset/index.js';

// Generation surface.
export type {
  AtmosphereSpec,
  CompositionClass,
  CraterSpec,
  DerivedHints,
  PhysicalWorldSpec,
  PressureBand,
  TemperatureBand,
  World,
} from './spec.js';
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
