/**
 * The generator-version registry (PRD R15, plan §9.5).
 *
 * A share URL carries `?gen=0.2.0` (R14, R27), so a version arriving from
 * outside has to be resolved, and one this build cannot produce has to fail
 * loudly. This is the seam that does it.
 *
 * ## Why there is one entry, and why that is not a reason to skip the seam
 *
 * R15 obliges the app to render worlds from every generator version it has ever
 * emitted. **Nothing has been emitted**: PRD §7's release policy is that nothing
 * ships before Phase 5, so no user can be holding a `0.1.0` share URL and
 * retaining `0.1.0`'s implementation would mean carrying a second kernel to
 * serve nobody. Its manifests are archived instead, under
 * `packages/golden/archive/`, which is the only record of what Phase 0
 * produced.
 *
 * What is built now is the shape. ADR-0001's lesson is that **a seam that is
 * exercised works and a seam that is not, does not** — a registry added on the
 * day a second version lands is a registry whose first use is also its first
 * test, at the moment there is a live URL depending on it. So this one is
 * exercised from the day it exists: the viewer resolves `?gen=` through it, and
 * `generators.test.ts` asserts that an unknown version throws by name rather
 * than falling back.
 *
 * ## The failure this exists to prevent
 *
 * Not "an old URL does not open". That is a visible, honest failure. The
 * dangerous one is an old URL opening and rendering **a different world with
 * the same address** — plausible, wrong, and indistinguishable from the real
 * thing without the hash. Which is why {@link generatorFor} never falls back to
 * the current version, exactly as `requireRuleset` never falls back to
 * `cepheus-1`. The two registries are the same decision about two identities,
 * and they are deliberately written to look alike.
 *
 * ## What this is not
 *
 * Not a kernel choice. `TsTileGenerator` and `WasmTileGenerator` are two
 * implementations of *one* version's arithmetic, selected per platform and
 * held to bit-equality by `golden:parity`; that seam is `KernelApi` in the
 * golden harness. This one selects **which arithmetic**, and a future entry
 * here would be a frozen copy of a past kernel, not a second way of running
 * this one.
 */
import { GEN_VERSION } from './version.js';
import type { TileGenerator } from './tile/generator.js';
import { TsTileGenerator } from './tile/generator.js';

/** One generator version this build can produce worlds for. */
export interface GeneratorEntry {
  /** The exact `genVersion` string, as it appears in a share URL. */
  readonly version: string;
  /** Construct a generator for it. */
  readonly create: () => TileGenerator;
  /** What this version is, for a reader deciding whether it may be removed. */
  readonly note: string;
}

/**
 * Every generator version this build can render.
 *
 * Grows, and never shrinks once a version has been released — the same rule
 * `RULESETS` follows, for the same reason, and the reason it does not apply
 * yet is written above rather than assumed.
 */
export const GENERATORS: readonly GeneratorEntry[] = Object.freeze([
  {
    version: GEN_VERSION,
    create: (): TileGenerator => new TsTileGenerator(GEN_VERSION),
    note: 'current — Phase 1: fBm terrain, two-tier crater fields, regolith albedo',
  },
]);

/** Versions this build can render, in registry order. */
export function knownGeneratorVersions(): readonly string[] {
  return GENERATORS.map((g) => g.version);
}

/** Resolve a generator version, or `undefined` if this build does not have it. */
export function generatorEntryFor(version: string): GeneratorEntry | undefined {
  return GENERATORS.find((g) => g.version === version);
}

/**
 * Construct a generator for a version, throwing if this build does not have it.
 *
 * Never falls back to the current version. See the module header for why that
 * is the whole point of the function.
 */
export function generatorFor(version: string): TileGenerator {
  const entry = generatorEntryFor(version);
  if (entry === undefined) {
    throw new Error(
      `unknown generator version '${version}'. This build produces: ` +
        `${knownGeneratorVersions().join(', ')}. Rendering it with a different generator would ` +
        'show a world that is not the one the link promised (PRD R15).',
    );
  }
  return entry.create();
}
