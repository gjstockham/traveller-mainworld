/**
 * The fixture manifest — the committed record of what whole generated worlds
 * look like (PRD R16, implementation plan §7.2).
 *
 * ## Why this is a second artefact and not more rows in `manifest.json`
 *
 * `manifest.json` records the *determinism battery*: kernel functions over
 * hostile inputs. It is keyed on `genVersion` alone, and its digest is cited as
 * evidence — in `docs/evidence/wp4-manual-checks.md` and ADR-0001 §E1 — for one
 * specific claim, that the arithmetic is identical across engines. This file
 * records something else: ten fixture worlds, each generated across a fixed
 * tile set, hashed per output buffer.
 *
 * They are kept apart because they answer to different identities, and the
 * argument starts with what `genVersion` is. It is not a manifest key. It is
 * embedded in share URLs (PRD R14, R27), stamped into exports, part of the tile
 * cache identity, and PRD R15 obliges the app to keep a code path alive for
 * every version it has ever emitted. A fixture spec is a *test input*: editing
 * one alters output for no input a user can reach. Bumping `genVersion` for it
 * would mint a phantom version with no code behind it and then oblige R15 to
 * carry it.
 *
 * So **`genVersion` covers `core` only** (implementation plan §10 q5), and the
 * fixture set carries its own identity — {@link FixtureManifest.fixtureSpecHash},
 * computed by `fixtures.ts` over the specs, seeds, tile set and grid size.
 * Editing a fixture moves that hash, visibly, and the change protocol requires
 * a changelog entry naming it — without touching the kernel's version and
 * without invalidating evidence about arithmetic that did not change.
 *
 * Once the fixture set needs its own key regardless, folding these hashes into
 * `manifest.json` would buy one file and cost the thing that matters: the
 * battery digest would then move whenever a fixture radius changed, so every
 * citation of it as *kernel* evidence would go stale for reasons unrelated to
 * the kernel.
 *
 * ## The cost of two files, and what pays it
 *
 * Two artefacts can drift. Three things stop that being a standing question:
 * both carry `genVersion` and {@link fixtureManifestPreflight} refuses to
 * compare when they disagree; `golden:verify` runs both, so there is no
 * command that checks one and reports success; and every matrix cell asserts
 * both ran.
 */
import type { FixtureResult } from './fixtures.js';

/** Per-buffer hashes as committed. */
export interface FixtureEntry {
  readonly elevation: string;
  readonly waterMask: string;
  readonly materials: string;
  readonly albedo: string;
  readonly tiles: number;
  readonly vertices: number;
  /**
   * Whether the water mask was all zeros when this manifest was written.
   *
   * `true` for every Phase 0 fixture, because Phase 0 worlds are airless and
   * `generateTile` writes a constant zero. Recorded as data so that the
   * `waterMask` hash cannot read as coverage it does not have: it is the hash
   * of a constant, and it will keep matching when the Phase 2 water pass lands
   * broken. `fixtures.test.ts` asserts this flag against the real buffer, so
   * the day it stops being true the suite says so.
   */
  readonly waterMaskAllZero: boolean;
  /**
   * How many distinct albedo bytes this fixture produced.
   *
   * The mirror image of {@link FixtureEntry.waterMaskAllZero}, and recorded for
   * the same reason from the opposite direction. The water-mask flag stops a
   * hash of a constant reading as coverage; this stops an albedo hash reading as
   * coverage *before* it is one. A field that silently collapsed — a province
   * frequency too low to vary inside a tile, a palette offset that never reached
   * the buffer — would hash perfectly and identically across all ten worlds, and
   * this number is what turns that into a visible diff and a red test.
   */
  readonly albedoDistinctValues: number;
}

export interface FixtureManifest {
  /** Generator version these hashes were produced under. Covers `core` only. */
  readonly genVersion: string;
  /** Identity of the fixture inputs — specs, seeds, tile set, grid size. */
  readonly fixtureSpecHash: string;
  /** Grid resolution each fixture tile was generated at. */
  readonly fixtureN: number;
  /** Tiles per fixture. */
  readonly tileCount: number;
  /** Digest over every fixture's three hashes — the single value to eyeball. */
  readonly digest: string;
  /** Per-fixture hashes, keyed by fixture id. */
  readonly fixtures: Readonly<Record<string, FixtureEntry>>;
}

export interface FixtureMismatch {
  readonly fixture: string;
  /** Which output buffer, or `'(fixture)'` when the whole entry is absent. */
  readonly buffer: string;
  readonly expected: string | undefined;
  readonly actual: string | undefined;
  readonly reason: 'differs' | 'missing-from-manifest' | 'missing-from-run' | 'shape';
}

/** Build a fixture manifest from a run. */
export function buildFixtureManifest(
  genVersion: string,
  fixtureSpecHash: string,
  fixtureN: number,
  results: readonly FixtureResult[],
  digest: string,
): FixtureManifest {
  const fixtures: Record<string, FixtureEntry> = {};
  for (const r of results) {
    fixtures[r.id] = {
      elevation: r.elevation,
      waterMask: r.waterMask,
      materials: r.materials,
      albedo: r.albedo,
      tiles: r.tiles,
      vertices: r.vertices,
      waterMaskAllZero: r.waterMaskAllZero,
      albedoDistinctValues: r.albedoDistinct,
    };
  }
  return {
    genVersion,
    fixtureSpecHash,
    fixtureN,
    tileCount: results[0]?.tiles ?? 0,
    digest,
    fixtures,
  };
}

/**
 * Whether a comparison against this manifest would mean anything.
 *
 * Returns a reason to stop, or `undefined` to proceed. Separated from
 * {@link compareFixtureManifest} because "your manifest is for a different
 * generator" and "fixture `size4-luna` produced a different elevation hash" are
 * different findings, and reporting the first as thirty of the second is how a
 * harness problem gets mistaken for a determinism problem.
 */
export function fixtureManifestPreflight(
  manifest: FixtureManifest,
  genVersion: string,
  fixtureSpecHash: string,
  fixtureN: number,
): string | undefined {
  if (manifest.genVersion !== genVersion) {
    return (
      `fixtures.json is for generator ${manifest.genVersion}, this build is ${genVersion}. ` +
      'Regenerate it in the same PR as the version bump (pnpm golden:update:fixtures).'
    );
  }
  if (manifest.fixtureSpecHash !== fixtureSpecHash) {
    return (
      `fixture specs have changed: manifest ${short(manifest.fixtureSpecHash)}, ` +
      `this build ${short(fixtureSpecHash)}. The hashes below would be comparing different ` +
      'worlds. Regenerate with pnpm golden:update:fixtures, which requires a changelog entry.'
    );
  }
  if (manifest.fixtureN !== fixtureN) {
    return (
      `fixtures.json was produced at n=${String(manifest.fixtureN)}, this build uses ` +
      `n=${String(fixtureN)}. Different grids sample different points; the hashes are not comparable.`
    );
  }
  return undefined;
}

/** Compare a fixture run against the manifest, per buffer. */
export function compareFixtureManifest(
  manifest: FixtureManifest,
  results: readonly FixtureResult[],
): FixtureMismatch[] {
  const mismatches: FixtureMismatch[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    seen.add(r.id);
    const expected = manifest.fixtures[r.id];
    if (expected === undefined) {
      mismatches.push({
        fixture: r.id,
        buffer: '(fixture)',
        expected: undefined,
        actual: r.elevation,
        reason: 'missing-from-manifest',
      });
      continue;
    }

    // Shape before hashes: a fixture that generated half the tiles would
    // otherwise report three hash differences and no reason for any of them.
    if (expected.tiles !== r.tiles || expected.vertices !== r.vertices) {
      mismatches.push({
        fixture: r.id,
        buffer: '(shape)',
        expected: `${String(expected.tiles)} tiles, ${String(expected.vertices)} vertices`,
        actual: `${String(r.tiles)} tiles, ${String(r.vertices)} vertices`,
        reason: 'shape',
      });
    }

    for (const buffer of ['elevation', 'waterMask', 'materials', 'albedo'] as const) {
      if (expected[buffer] !== r[buffer]) {
        mismatches.push({
          fixture: r.id,
          buffer,
          expected: expected[buffer],
          actual: r[buffer],
          reason: 'differs',
        });
      }
    }
  }

  for (const id of Object.keys(manifest.fixtures)) {
    if (!seen.has(id)) {
      mismatches.push({
        fixture: id,
        buffer: '(fixture)',
        expected: manifest.fixtures[id]!.elevation,
        actual: undefined,
        reason: 'missing-from-run',
      });
    }
  }

  return mismatches;
}

/** Human-readable mismatch report for CI output. */
export function formatFixtureMismatches(mismatches: readonly FixtureMismatch[]): string {
  if (mismatches.length === 0) {
    return 'All fixture hashes match fixtures.json.';
  }
  const lines = [`${String(mismatches.length)} fixture mismatch(es):`, ''];
  for (const m of mismatches) {
    switch (m.reason) {
      case 'differs':
      case 'shape':
        lines.push(
          `  ${m.fixture} / ${m.buffer}`,
          `    expected ${m.expected ?? '—'}`,
          `    actual   ${m.actual ?? '—'}`,
        );
        break;
      case 'missing-from-manifest':
        lines.push(`  ${m.fixture}: new fixture, not in fixtures.json (regenerate it)`);
        break;
      case 'missing-from-run':
        lines.push(`  ${m.fixture}: in fixtures.json but not produced by this run`);
        break;
    }
  }
  lines.push(
    '',
    'If this change is intentional it needs, in the SAME PR: a generator version',
    'bump or a fixture-spec change, a regenerated fixtures.json, and a CHANGELOG',
    'entry naming whichever identity moved. See README "The change protocol".',
  );
  return lines.join('\n');
}

function short(hash: string): string {
  return `${hash.slice(0, 16)}…`;
}
