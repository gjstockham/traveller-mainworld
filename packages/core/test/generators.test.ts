/**
 * WP14: the generator-version registry (PRD R15, plan §9.5).
 *
 * The registry has one entry, so most of what can be tested about it is what it
 * does with the *other* versions — which is the half that matters. ADR-0001's
 * lesson is that a seam that is exercised works and a seam that is not, does
 * not; a registry whose only test is "the one entry resolves" is a registry
 * whose refusal path runs for the first time on the day a real share URL
 * depends on it.
 */
import {
  FIXTURES,
  GEN_VERSION,
  GENERATORS,
  TsTileGenerator,
  canonicalBytes,
  generatorEntryFor,
  generatorFor,
  knownGeneratorVersions,
  makeTileId,
  sha256Hex,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('the generator registry', () => {
  it('has the version this build produces, and resolves it', () => {
    expect(knownGeneratorVersions()).toContain(GEN_VERSION);
    expect(generatorFor(GEN_VERSION).genVersion).toBe(GEN_VERSION);
  });

  it('REFUSES AN UNKNOWN VERSION RATHER THAN FALLING BACK', () => {
    // The whole point. Silently returning the current generator would render a
    // world that is not the one the link promised — plausible, wrong, and
    // indistinguishable from the real thing without a hash. That is strictly
    // worse than a link that fails to open, and it is the failure R15 exists to
    // prevent.
    expect(() => generatorFor('0.1.0')).toThrow(/unknown generator version '0\.1\.0'/);
    expect(() => generatorFor('0.1.0')).toThrow(/R15/);
    // The message names what the build does have, so the error is actionable
    // without reading the source.
    expect(() => generatorFor('0.1.0')).toThrow(new RegExp(escape(GEN_VERSION)));
  });

  it('refuses the empty string and near-misses, not just obviously wrong input', () => {
    // A prefix or a `v` are the two shapes a hand-edited URL actually takes,
    // and a lookup that trimmed or coerced would accept both.
    for (const asked of ['', 'v' + GEN_VERSION, GEN_VERSION + ' ', GEN_VERSION + '-alpha.4']) {
      expect(() => generatorFor(asked), `'${asked}' resolved`).toThrow(/unknown generator version/);
    }
  });

  it('reports an unknown version as undefined for callers that want to branch', () => {
    expect(generatorEntryFor(GEN_VERSION)).toBeDefined();
    expect(generatorEntryFor('0.1.0')).toBeUndefined();
  });

  it('describes every entry, so a reader can tell whether one may be removed', () => {
    expect(GENERATORS.length).toBeGreaterThan(0);
    for (const entry of GENERATORS) {
      expect(entry.version, 'a registry entry with no version').toBeTruthy();
      expect(entry.note.length, `entry '${entry.version}' has no note`).toBeGreaterThan(10);
    }
    expect(new Set(GENERATORS.map((g) => g.version)).size).toBe(GENERATORS.length);
  });

  it('PRODUCES THE SAME WORLD AS THE GENERATOR THE HARNESS CONSTRUCTS DIRECTLY', () => {
    // The registry is a lookup returning a constructed generator, so it could
    // resolve to something subtly different from what `golden:verify` runs —
    // a stale version string, a different class — and every test above would
    // still pass. This is the one that would notice, and it compares the thing
    // that actually matters: the bytes.
    const n = 32;
    const tileId = makeTileId(3, 4, 0b10110110);
    const world = FIXTURES[2]!.world;
    const per = (n + 1) * (n + 1);
    const hash = (tile: { elevation: Float64Array }): string =>
      sha256Hex(canonicalBytes(tile.elevation.subarray(0, per)));

    expect(hash(generatorFor(GEN_VERSION).generate(tileId, world, n))).toBe(
      hash(new TsTileGenerator(GEN_VERSION).generate(tileId, world, n)),
    );
  });

  it('hands out independent generators rather than one shared instance', () => {
    // Tile generators hold scratch buffers. Two callers sharing one would be a
    // data race the moment the viewer's pool and an export ran together, and it
    // would show up as a corrupted tile rather than as an error.
    expect(generatorFor(GEN_VERSION)).not.toBe(generatorFor(GEN_VERSION));
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
