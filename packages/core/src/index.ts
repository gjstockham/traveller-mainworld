/**
 * @traveller-mainworld/core — headless deterministic world generation.
 *
 * No rendering dependencies (PRD R9): this package must stay consumable from
 * the viewer, from Node scripts, and from future suite tools alike.
 */

// The generator version (PRD R14). Its own module since WP14, so that
// `generators.ts` can key a registry on it without importing this barrel.
export * from './version.js';

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
export * from './kernel/regolith.js';
export * from './kernel/tilegen.js';

// The regolith palette (PRD §9.4). Scalars come out of the kernel; the RGB
// mapping lives here, outside the whitelisted zone, so that the viewer and the
// exporter colour a sample through the same function and tuning it costs no
// version bump. See the module header for the boundary.
export * from './palette/index.js';

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
// Which generator version a share URL resolves to (R15). One entry, exercised
// from the day it exists — see the module header for why that matters.
export * from './generators.js';

// The WASM kernel twin (WP3). Marshalling only — no generation arithmetic — so
// it sits outside the whitelisted zone. Loading the module is the caller's job,
// which keeps this import free of any Node or browser specifics.
export * from './wasm/kernel.js';
export * from './wasm/generator.js';

// Verification.
export * from './digest/index.js';
