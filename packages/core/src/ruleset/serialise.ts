/**
 * Canonical serialisation of a `PhysicalWorldSpec`, and its hash.
 *
 * ## What this is for
 *
 * Phase 1 plan §4.3: **golden fixtures pin the interpreted spec, not just the
 * tile hashes.** WP14 hashes `interpret(upp, ruleset)` for every fixture, so
 * an edit to a `cepheus-1` table fails CI on a spec hash before it ever
 * reaches a tile. Without that, a one-digit table edit silently changes every
 * world anyone has ever shared and nothing catches it. This module is the half
 * of that mechanism that belongs in `core`; WP14 wires it into the manifest.
 *
 * Until then it is not idle: `packages/core/test/data/` pins ten specs by
 * hash, and `scripts/update-ruleset-expectations.mjs` uses it to decide
 * whether a table has moved.
 *
 * ## Why the field list is written out
 *
 * Field order and formatting are fixed here rather than delegated to
 * `JSON.stringify`, because this string is a committed identity: it must not
 * change because a property was reordered in an interface or because a
 * serialiser changed how it renders a number. `String(number)` is safe — the
 * ECMAScript number-to-string algorithm is exact and specified, so every
 * engine renders these identically. This mirrors `serialiseFixtureSpecs` in
 * the golden harness, and for the same reasons.
 *
 * The cost of writing the list out is that a field added to
 * `PhysicalWorldSpec` and not added here is hashed as though it did not exist.
 * `packages/core/test/serialise.test.ts` walks the spec's own leaves and fails
 * on any that this file does not mention, so that cost is paid by a red test
 * rather than by a silent gap.
 */
import { sha256Hex } from '../digest/sha256.js';
import type { PhysicalWorldSpec } from '../spec.js';

/** Bytes of an ASCII string. Mirrors the golden harness, and rejects non-ASCII. */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(
        `spec serialisation must be ASCII so its bytes are unambiguous; found U+${code
          .toString(16)
          .toUpperCase()} at ${String(i)}`,
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Every leaf of a `PhysicalWorldSpec`, as `path=value` lines in a fixed order.
 *
 * The paths match the interface's own nesting, so a line reads the way the
 * field is accessed: `craters.transitionDiameterKm`, not
 * `craterTransitionDiameter`.
 */
export function serialiseSpec(spec: PhysicalWorldSpec): string {
  const lines = [
    `radiusKm=${String(spec.radiusKm)}`,
    `surfaceGravityG=${String(spec.surfaceGravityG)}`,
    `atmosphere.pressureBand=${spec.atmosphere.pressureBand}`,
    `atmosphere.pressureBar=${String(spec.atmosphere.pressureBar)}`,
    `atmosphere.composition=${spec.atmosphere.composition}`,
    `hydrographicCoverage=${String(spec.hydrographicCoverage)}`,
    `hints.temperatureBand=${spec.hints.temperatureBand}`,
    `hints.iceLikelihood=${String(spec.hints.iceLikelihood)}`,
    `hints.terrainRoughness=${String(spec.hints.terrainRoughness)}`,
    `craters.densityScale=${String(spec.craters.densityScale)}`,
    `craters.transitionDiameterKm=${String(spec.craters.transitionDiameterKm)}`,
    `craters.regolithMaturity=${String(spec.craters.regolithMaturity)}`,
    `terrainAmplitudeM=${String(spec.terrainAmplitudeM)}`,
    `fbm.octaves=${String(spec.fbm.octaves)}`,
    `fbm.frequency=${String(spec.fbm.frequency)}`,
    `fbm.amplitude=${String(spec.fbm.amplitude)}`,
    `fbm.lacunarity=${String(spec.fbm.lacunarity)}`,
    `fbm.gain=${String(spec.fbm.gain)}`,
  ];
  return `${lines.join('\n')}\n`;
}

/** Identity of one interpreted spec. */
export function specHash(spec: PhysicalWorldSpec): string {
  return sha256Hex(asciiBytes(serialiseSpec(spec)));
}

/**
 * Every dotted leaf path reachable from a value, in traversal order.
 *
 * Used by the coverage tests — here, and in the golden harness, where the
 * question is which spec fields `serialiseFixtureSpecs` covers. Exported
 * rather than duplicated in two test files, because a coverage check with two
 * implementations is a coverage check with one bug.
 */
export function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  const paths: string[] = [];
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    paths.push(...leafPaths(child, prefix === '' ? key : `${prefix}.${key}`));
  }
  return paths;
}
