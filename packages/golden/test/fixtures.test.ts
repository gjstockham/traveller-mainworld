import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FACE_COUNT,
  GEN_VERSION,
  MAX_OCTAVES,
  type ParsedUpp,
  type TileData,
  type TileGenOutput,
  type TileGenerator,
  TsTileGenerator,
  type World,
  canonicalBytes,
  fidelityFor,
  interpret,
  isUppError,
  leafPaths,
  makeTileId,
  parseUpp,
  requireRuleset,
  sha256Hex,
  tileBounds,
  tileDepth,
  tileFace,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { BATTERY, HOSTILE_FBM } from '../src/battery.js';

import {
  type FixtureManifest,
  buildFixtureManifest,
  compareFixtureManifest,
  fixtureManifestPreflight,
  formatFixtureMismatches,
} from '../src/fixtureManifest.js';
import {
  FIXTURES,
  FIXTURE_MAX_DEPTH,
  FIXTURE_N,
  FIXTURE_TILES,
  FULL_FIXTURES,
  QUICK_FIXTURES,
  buildFixtureTiles,
  fixtureSpecHash,
  fixturesDigest,
  runFixture,
  runFixtures,
  serialiseFixtureSpecs,
} from '../src/fixtures.js';

const MANIFEST: FixtureManifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures.json'), 'utf8'),
) as FixtureManifest;

const tsGenerator = (): TileGenerator => new TsTileGenerator(GEN_VERSION);

describe('the fixture set', () => {
  it('is ten worlds with unique ids', () => {
    expect(FIXTURES.length).toBe(10);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(10);
  });

  it('spans the size range rather than clustering', () => {
    const radii = FIXTURES.map((f) => f.world.spec.radiusKm).sort((a, b) => a - b);
    // Cepheus sizes 1 to A, read literally as ~800 km per point of Size.
    expect(radii[0]).toBeLessThanOrEqual(800);
    expect(radii.at(-1)).toBeGreaterThanOrEqual(8000);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i], 'two fixtures share a radius').toBeGreaterThan(radii[i - 1]!);
    }
  });

  it('IS WHAT A UPP PRODUCES, WITH NOTHING APPLIED ON TOP', () => {
    // The WP14 change, asserted rather than described. Until WP14 each fixture
    // interpreted a UPP and then overrode the fBm block, so the manifest pinned
    // ten worlds the shipping path could not reach and the path a user *can*
    // reach — paste a UPP, get a planet — was pinned nowhere.
    //
    // Re-interpreting from scratch and comparing the whole spec is the check
    // that no override has crept back in. A field-by-field list would pass over
    // any field somebody added later, which is precisely how the fBm override
    // survived WP9.
    for (const f of FIXTURES) {
      const parsed = parseUpp(f.upp);
      expect(isUppError(parsed), `fixture '${f.id}' has an unparseable UPP`).toBe(false);
      expect(
        f.world.spec,
        `fixture '${f.id}' is not what its UPP interprets to — something is being applied on top`,
      ).toEqual(interpret(parsed as ParsedUpp, requireRuleset(f.rulesetId)));
    }
  });

  it('stays inside the Phase 1 scope fence', () => {
    // Atmo 0-1, Hydro 0 (plan §1, §9.1). A fixture outside it would be pinned
    // at reduced fidelity — hashing a world the generator is knowingly drawing
    // wrong, which is a hash of a placeholder.
    for (const f of FIXTURES) {
      const upp = parseUpp(f.upp) as ParsedUpp;
      expect(upp.atmosphere, `fixture '${f.id}' atmosphere`).toBeLessThanOrEqual(1);
      expect(upp.hydrographics, `fixture '${f.id}' hydrographics`).toBe(0);
      expect(fidelityFor(upp, requireRuleset(f.rulesetId)).reduced).toBe(false);
    }
  });

  it('varies the generator inputs, not just the seed', () => {
    // What `cepheus-1` actually varies across Size 1-A. The fBm gain and
    // lacunarity columns are gone — the interpreter gives every world 0.5 and 2
    // — and their coverage moved to `battery.ts`'s `noise.fbm3.params` case,
    // which is asserted below rather than left to a comment.
    const distinct = (pick: (w: World) => number): number =>
      new Set(FIXTURES.map((f) => pick(f.world))).size;
    expect(distinct((w) => w.spec.radiusKm)).toBe(10);
    expect(distinct((w) => w.spec.terrainAmplitudeM)).toBeGreaterThanOrEqual(8);
    expect(distinct((w) => w.spec.fbm.octaves)).toBeGreaterThanOrEqual(5);
    expect(distinct((w) => w.spec.fbm.frequency)).toBe(10);

    // Atmosphere is not decoration here: it is the only input to
    // `craters.densityScale` that is not size, so both of its values have to
    // appear or the crater column varies with exactly one thing.
    expect(distinct((w) => w.spec.craters.densityScale)).toBe(2);
    expect(distinct((w) => w.spec.craters.regolithMaturity)).toBe(2);
    expect(distinct((w) => w.spec.craters.transitionDiameterKm)).toBe(10);

    // The awkward seed lanes, which a mixer is most likely to collapse.
    const seeds = FIXTURES.map((f) => [f.world.seedHi >>> 0, f.world.seedLo >>> 0] as const);
    expect(seeds).toContainEqual([0, 0]);
    expect(seeds).toContainEqual([0xffffffff, 0xffffffff]);
    expect(seeds.some(([hi]) => hi === 0x80000000)).toBe(true);
  });

  it('does not correlate atmosphere with size, or with the awkward seeds', () => {
    // Both crater-preservation values have to appear at both ends of the size
    // range, or a bug that reads size where it means atmosphere is invisible.
    const byAtmo = new Map<number, number[]>();
    for (const f of FIXTURES) {
      const scale = f.world.spec.craters.densityScale;
      byAtmo.set(scale, [...(byAtmo.get(scale) ?? []), f.world.spec.radiusKm]);
    }
    expect(byAtmo.size).toBe(2);
    for (const [scale, radii] of byAtmo) {
      expect(radii.length, `only one fixture at densityScale ${String(scale)}`).toBeGreaterThan(1);
      expect(Math.min(...radii), `densityScale ${String(scale)} is all large worlds`).toBeLessThan(
        3000,
      );
      expect(Math.max(...radii), `densityScale ${String(scale)} is all small worlds`).toBeGreaterThan(
        5000,
      );
    }
  });

  it('CARRIES THE fBm LANES IT GAVE UP, IN THE BATTERY', () => {
    // The other half of the WP14 trade, and the half that is easy to lose: the
    // fixture override bought gain either side of 0.5, non-dyadic lacunarity
    // and octave counts up to the clamp, and interpreting cleanly gives all of
    // that up. If `HOSTILE_FBM` were ever trimmed, the coverage would be gone
    // from both places at once and nothing else would say so.
    const params = BATTERY.find((c) => c.name === 'noise.fbm3.params');
    expect(params, 'the battery case the fixture set traded its fBm diversity for').toBeDefined();

    const gains = new Set(HOSTILE_FBM.map((p) => p.gain));
    expect([...gains].filter((g) => g < 0.5).length).toBeGreaterThan(0);
    expect([...gains].filter((g) => g > 0.5).length).toBeGreaterThan(0);
    expect(HOSTILE_FBM.some((p) => !Number.isInteger(p.lacunarity))).toBe(true);
    expect(Math.max(...HOSTILE_FBM.map((p) => p.octaves))).toBe(MAX_OCTAVES);
  });
});

describe('the fixture tile set', () => {
  it('covers all six faces at every depth 0 to 6', () => {
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let depth = 0; depth <= FIXTURE_MAX_DEPTH; depth++) {
        expect(
          FIXTURE_TILES.some((id) => tileFace(id) === face && tileDepth(id) === depth),
          `no tile on face ${String(face)} at depth ${String(depth)}`,
        ).toBe(true);
      }
    }
  });

  it('includes all four corners of every face', () => {
    // The corner cases the tangent warp is most likely to get wrong, and the
    // ones `tile.composite` in the battery reaches none of.
    for (let face = 0; face < FACE_COUNT; face++) {
      const corners = new Set<string>();
      for (const id of FIXTURE_TILES) {
        if (tileFace(id) !== face || tileDepth(id) === 0) continue;
        const { u0, v0, size } = tileBounds(id);
        const atU = u0 === 0 || u0 + size === 1;
        const atV = v0 === 0 || v0 + size === 1;
        if (atU && atV) corners.add(`${String(u0 === 0 ? 0 : 1)}${String(v0 === 0 ? 0 : 1)}`);
      }
      expect(corners.size, `face ${String(face)} does not reach all four corners`).toBe(4);
    }
  });

  it('includes edge-adjacent tiles that are not corners, in both orientations', () => {
    let uEdge = 0;
    let vEdge = 0;
    for (const id of FIXTURE_TILES) {
      if (tileDepth(id) < 2) continue;
      const { u0, v0, size } = tileBounds(id);
      const atU = u0 === 0 || u0 + size === 1;
      const atV = v0 === 0 || v0 + size === 1;
      if (atU && !atV) uEdge++;
      if (atV && !atU) vEdge++;
    }
    // A corner tile does not cover the case of an edge tile: it agrees with its
    // face boundary on both axes, so a bug that only shows when one coordinate
    // is interior would survive it.
    expect(uEdge, 'no tile hugs a u edge without also being a corner').toBeGreaterThan(0);
    expect(vEdge, 'no tile hugs a v edge without also being a corner').toBeGreaterThan(0);
  });

  it('is 90 tiles, and every id is distinct', () => {
    expect(FIXTURE_TILES.length).toBe(90);
    expect(new Set(FIXTURE_TILES).size).toBe(FIXTURE_TILES.length);
  });

  it('shrinks with maxDepth, for the quick run only', () => {
    expect(buildFixtureTiles(2).length).toBeLessThan(FIXTURE_TILES.length);
    expect(buildFixtureTiles(FIXTURE_MAX_DEPTH)).toEqual([...FIXTURE_TILES]);
  });
});

describe('the fixture-spec hash', () => {
  it('is stable across calls', () => {
    expect(fixtureSpecHash()).toBe(fixtureSpecHash());
  });

  it('matches the committed manifest', () => {
    // If this fails, the fixture specs were edited without regenerating
    // fixtures.json — which is the silent-drift case the second key exists to
    // make loud.
    expect(fixtureSpecHash()).toBe(MANIFEST.fixtureSpecHash);
  });

  it('moves when a spec changes', () => {
    const edited = FIXTURES.map((f, i) =>
      i === 3
        ? { ...f, world: { ...f.world, spec: { ...f.world.spec, radiusKm: 3201 } } }
        : f,
    );
    expect(fixtureSpecHash(edited)).not.toBe(fixtureSpecHash());
  });

  it('moves when the tile set or grid size changes', () => {
    expect(fixtureSpecHash(FIXTURES, buildFixtureTiles(5))).not.toBe(fixtureSpecHash());
    expect(fixtureSpecHash(FIXTURES, FIXTURE_TILES, 64)).not.toBe(fixtureSpecHash());
  });

  it('does not move when a description changes', () => {
    // Fixing a typo is not a change to what is generated and should not cost a
    // protocol event.
    const edited = FIXTURES.map((f) => ({ ...f, description: `${f.description} (reworded)` }));
    expect(fixtureSpecHash(edited)).toBe(fixtureSpecHash());
  });

  it('serialises to ASCII, with every input field present', () => {
    const text = serialiseFixtureSpecs();
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    for (const f of FIXTURES) {
      expect(text).toContain(`fixture=${f.id}`);
      expect(text).toContain(`radiusKm=${String(f.world.spec.radiusKm)}`);
      expect(text).toContain(`fbm.gain=${String(f.world.spec.fbm.gain)}`);
    }
    expect(text).toContain(`n=${String(FIXTURE_N)}`);
  });
});

/**
 * Fields of `PhysicalWorldSpec` that move no hashed buffer, and why each does
 * not.
 *
 * **This list stopped gating the serialiser in WP14, and it is worth being
 * precise about what it now means.** Until WP14 the fixture-spec hash covered
 * only the fields generation read, and this was the excuse list for the rest: a
 * field was either serialised or listed here, and a pair of tests made that a
 * partition. WP14 hashes the whole interpreted spec — plan §4.3's spec hashing,
 * which is the enforcement for R7 — so every field is covered and there is
 * nothing left to excuse.
 *
 * What the list still is, and the reason it was kept rather than deleted with
 * the check that used it, is **a claim about the generator**: these fields
 * cannot move a hashed buffer, and everything else can. That is now asserted in
 * *both* directions below, which the excuse-list version could not do — it only
 * ever checked that the listed fields were inert, never that the unlisted ones
 * were live. A field that quietly stopped reaching generation would have sat in
 * the serialiser looking like coverage.
 *
 * The two kinds of entry are not the same kind of thing, and the difference
 * matters to anyone deciding whether a line here may be removed:
 *
 * - **Pending** — a real input that the current phase does not consume yet. The
 *   phase that will consume it is named, and on the day it does, this line goes
 *   and the partition test says so.
 * - **Inert** — a field that no phase will consume, because the arithmetic
 *   cancels it. `fbm.amplitude` is the only one, it was found by the
 *   bidirectional check on its first run, and it does not go away: see
 *   `fbm.amplitude cancels` below for the measurement.
 */
const MOVES_NO_HASHED_BUFFER: Readonly<Record<string, string>> = {
  surfaceGravityG: 'pending: stored only; WP10 uses it via craters.transitionDiameterKm',
  'atmosphere.pressureBand': 'pending: Phase 2 (sky)',
  'atmosphere.pressureBar': 'pending: Phase 2 (sky)',
  'atmosphere.composition': 'pending: Phase 2 (sky, surface tinting)',
  hydrographicCoverage: 'pending: Phase 2 (R8 sea-level solve)',
  'hints.temperatureBand': 'pending: Phase 4 (climate)',
  'hints.iceLikelihood': 'pending: Phase 4 (climate)',
  'hints.terrainRoughness': 'pending: derived from radiusKm and terrainAmplitudeM, both hashed',
  'fbm.amplitude': 'inert: cancels against fbmNormalisation — see the test below',
};

describe('the fixture-spec hash covers the whole spec', () => {
  const spec = FIXTURES[0]!.world.spec;
  const serialised = serialiseFixtureSpecs();

  it('serialises every field of PhysicalWorldSpec, with nothing excused', () => {
    // The WP14 property, from this side. `packages/core/test/serialise.test.ts`
    // asserts the same thing about `serialiseSpec` itself; this asserts that
    // the fixture identity actually carries it, which is a different claim —
    // the fixture serialiser could have gone back to naming its own subset.
    const unaccounted = leafPaths(spec).filter((path) => !serialised.includes(`spec.${path}=`));
    expect(
      unaccounted,
      'A field of PhysicalWorldSpec is missing from the fixture-spec hash. It should not be ' +
        'possible to get here without editing serialiseFixtureSpecs or serialiseSpec.',
    ).toEqual([]);
  });

  it('carries the UPP, the ruleset and the seed as well as the spec', () => {
    // The spec is what the ruleset made of the inputs; these are the inputs. A
    // hash of the output alone could not tell a changed UPP from a changed
    // table, and telling those apart is the whole of plan §4.3.
    for (const f of FIXTURES) {
      expect(serialised).toContain(`upp=${f.upp}`);
      expect(serialised).toContain(`ruleset=${f.rulesetId}`);
    }
    expect(serialised).toContain('seedHi=4294967295');
  });

  it('names a real field in every entry of the unread list', () => {
    const leaves = new Set(leafPaths(spec));
    expect(Object.keys(MOVES_NO_HASHED_BUFFER).filter((path) => !leaves.has(path))).toEqual([]);
  });

  /**
   * The guard WP9 could not write, WP10 could, and WP14 completes.
   *
   * `NOT_YET_GENERATED` is a claim about which spec fields reach a hashed
   * buffer. Until WP10 nothing checked it and nothing *could* — every listed
   * field had no effect on generation, so a perturbation test passed vacuously
   * over all of them and proved nothing about any. The moment a crater
   * parameter reached `generateTile` it stopped being vacuous.
   *
   * Both directions are checked here, and against **every hashed buffer**
   * rather than elevation alone — which is wider than it needs to be today, and
   * deliberately so. Measured: narrowing the probe to elevation changes not one
   * verdict, because every spec field that moves any hashed buffer also moves
   * elevation. The width is not there for a case that exists; it is there
   * because the claim being made is about *the buffers the manifest pins*, and
   * an elevation-only probe would quietly be making a narrower claim than the
   * manifest does. Phase 2's water pass is the first thing likely to break the
   * coincidence.
   *
   * A field this test cannot move is a field this test cannot vouch for — and a
   * field it *can* move while the list says otherwise is a fixture set that
   * cannot tell two worlds apart.
   */
  it('LISTS EXACTLY THE FIELDS THAT REACH NO HASHED BUFFER', () => {
    const n = 16;
    const tileId = makeTileId(2, 5, 0b1101100111);
    const world = FIXTURES[3]!.world;
    const baseline = tileHash(world, tileId, n);

    const wronglyListed: string[] = [];
    const wronglyOmitted: string[] = [];
    for (const path of leafPaths(world.spec)) {
      const moved = tileHash(perturb(world, path), tileId, n) !== baseline;
      const listed = MOVES_NO_HASHED_BUFFER[path] !== undefined;
      if (moved && listed) wronglyListed.push(path);
      if (!moved && !listed) wronglyOmitted.push(path);
    }

    // Collected and asserted once: an assertion per field would be eighteen
    // whole-tile generations reported as one failure each.
    expect(
      wronglyListed,
      'listed as moving no hashed buffer, but perturbing it moved one. Remove it from ' +
        'MOVES_NO_HASHED_BUFFER — the field is now generation input.',
    ).toEqual([]);
    expect(
      wronglyOmitted,
      'not listed, so it is claimed to reach generation, but perturbing it changed nothing. ' +
        'Either the generator stopped reading it, or it never did and the list is short.',
    ).toEqual([]);
  });

  it('would notice if perturbation could not move a hash at all', () => {
    // The check on the check. The loop above compares two populations, and if
    // `perturb` silently produced an unchanged world both would come back empty
    // and the whole test would pass while proving nothing.
    const n = 16;
    const tileId = makeTileId(2, 5, 0b1101100111);
    const world = FIXTURES[3]!.world;
    expect(tileHash(perturb(world, 'craters.densityScale'), tileId, n)).not.toBe(
      tileHash(world, tileId, n),
    );
  });

  /**
   * `fbm.amplitude` cancels, and the partition test above is the thing that
   * noticed.
   *
   * The tile pass computes `scale = terrainAmplitudeM / fbmNormalisation(fbm)`
   * and multiplies the fBm sum by it. Both the sum and the normalisation are
   * homogeneous of degree 1 in `fbm.amplitude`, so it divides out: the field is
   * a free parameter that decides nothing, and `terrainAmplitudeM` is the real
   * relief control. It is hashed anyway, because the fixture identity is the
   * whole interpreted spec and carving out exceptions is how a serialiser stops
   * matching the thing it serialises.
   *
   * **This is also the trap from the other side.** The repo's standing warning
   * is that a one-ulp perturbation is too weak to probe generation, so `perturb`
   * halves instead. Halving is exact in binary floating point, and this field is
   * scale-invariant — so for the one field in the spec where it matters, the
   * deliberately-strong probe is the one probe guaranteed to move nothing.
   * Asserted here in both directions rather than left as a footnote, because a
   * future reader looking at the list above should be able to find out whether
   * "inert" means "provably" or "as far as anyone checked".
   */
  it('IS EXACTLY INERT FOR DYADIC AMPLITUDES, AND ROUNDING FOR THE REST', () => {
    const n = 16;
    const tileId = makeTileId(2, 5, 0b1101100111);
    const world = FIXTURES[3]!.world;
    const withAmplitude = (amplitude: number): World => ({
      ...world,
      spec: { ...world.spec, fbm: { ...world.spec.fbm, amplitude } },
    });
    const baseline = tileHash(world, tileId, n);

    // Powers of two scale every partial product exactly, so the quotient is
    // bit-identical over a range no sane spec would contain.
    for (const amplitude of [0.25, 0.5, 2, 1024]) {
      expect(tileHash(withAmplitude(amplitude), tileId, n), `amplitude ${String(amplitude)}`).toBe(
        baseline,
      );
    }

    // Everything else rounds differently and so *does* move the hash — which is
    // why this field cannot simply be dropped from the serialiser.
    expect(tileHash(withAmplitude(0.3), tileId, n)).not.toBe(baseline);

    // But it moves it by nothing that is a planet. Measured against elevations
    // spanning kilometres, so the bound is absolute metres rather than a ratio
    // that could be satisfied by a flat world.
    const per = (n + 1) * (n + 1);
    const base = tsGenerator().generate(tileId, world, n).elevation.slice(0, per);
    const odd = tsGenerator().generate(tileId, withAmplitude(0.3), n).elevation.slice(0, per);
    let maxDiff = 0;
    let range = 0;
    for (let i = 0; i < per; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(base[i]! - odd[i]!));
      range = Math.max(range, Math.abs(base[i]!));
    }
    expect(range, 'the probe tile is flat, so the bound below means nothing').toBeGreaterThan(1000);
    expect(maxDiff, 'metres of elevation moved by a 3.3x change in fbm.amplitude').toBeLessThan(
      1e-9,
    );
  });
});

/**
 * SHA-256 over one tile's hashed buffers, through the shipping generator.
 *
 * Elevation, materials and albedo — the three the fixture manifest pins that
 * are not a constant. The water mask is excluded because it is all zeros in
 * Phase 1, so including it would add a fixed prefix to every hash and no
 * discrimination at all.
 */
function tileHash(world: World, tileId: number, n: number): string {
  const per = (n + 1) * (n + 1);
  const tile = tsGenerator().generate(tileId, world, n);
  return sha256Hex(
    canonicalBytes(
      Float64Array.from([
        ...tile.elevation.subarray(0, per),
        ...tile.materials.subarray(0, per),
        ...tile.albedo.subarray(0, per),
      ]),
    ),
  );
}

/**
 * A copy of `world` with one leaf of its spec substantially moved.
 *
 * **Halved, not nudged by an ulp**, and the difference matters. A one-ulp step
 * is the right perturbation for asking whether a *serialiser* reads a field —
 * it is what `interpret.test.ts` uses, for the reason recorded there — but it is
 * far too weak for asking whether a field reaches *generation*. Several of these
 * are compared against a hash to decide something: `craters.densityScale` is the
 * acceptance threshold for every crater candidate on the planet, and moving it
 * by one ulp changes no decision anywhere, so the guard passed over it in
 * silence on its first run. A field this test cannot move is a field this test
 * cannot vouch for.
 *
 * Non-numeric leaves (the pressure band, the composition class) take a
 * different valid value instead, since nudging a string is not a thing.
 */
function perturb(world: World, path: string): World {
  const keys = path.split('.');
  const clone = structuredClone(world.spec) as Record<string, unknown>;
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  const last = keys.at(-1)!;
  const current = node[last];
  node[last] =
    typeof current === 'number'
      ? // Zero has no half, and every numeric field here is a scale, a
        // probability or a length, so 0.5 is in range for all of them.
        current === 0
        ? 0.5
        : current * 0.5
      : current === 'none'
        ? 'trace'
        : 'none';
  return { ...world, spec: clone as unknown as World['spec'] };
}

/**
 * Every test in this block generates whole worlds, and none of them belongs on
 * vitest's five-second default.
 *
 * That default was never chosen for them — it is what they got by saying
 * nothing, while the comparable tests in `battery.test.ts`, `craters.test.ts`
 * and `regolith.test.ts` all carry explicit budgets of 120 s or more. The gap
 * showed up as a red `test (windows-latest)` leg on WP13's push: `discriminates:
 * a generator that ignores its tile id` had run in 3266 ms on WP12's commit and
 * 3477 ms on WP11's, then took **5064 ms** once WP13 added a fourth package's
 * worth of CPU-bound tests to run alongside it. Nothing about the test or the
 * generator changed; it was contention on a four-core runner.
 *
 * A test whose pass depends on what else is running is not measuring the thing
 * it names, and the next victim was already picked: `reproduces the committed
 * hashes for a full-size fixture` was at 22 470 ms of a 30 s budget on the same
 * run, and its explicit timeout was *tighter* than this block's, so it has been
 * removed in favour of this one.
 *
 * 120 s matches the sibling files. These are CPU-bound deterministic loops —
 * they do not hang in interesting ways, they just take a while on a slow box —
 * so a generous budget costs nothing and a tight one costs a red build on an
 * unrelated commit.
 */
describe('running fixtures', { timeout: 120_000 }, () => {
  it('reproduces the committed hashes for a full-size fixture', () => {
    // One fixture at the real size, not the whole set: each fixture's hashes are
    // independent, so this is a genuine comparison against the committed
    // artefact at a tenth of the cost. `pnpm golden:verify` does all ten.
    const fixture = FIXTURES[0]!;
    const result = runFixture(tsGenerator(), fixture);
    const expected = MANIFEST.fixtures[fixture.id]!;
    // The spec hash first. A run that generated the right bytes from the wrong
    // world would pass every line below it, and this is the assertion that was
    // missing when the manifest first grew the field.
    expect(result.specHash).toBe(expected.specHash);
    expect(result.elevation).toBe(expected.elevation);
    expect(result.materials).toBe(expected.materials);
    expect(result.albedo).toBe(expected.albedo);
    expect(result.waterMask).toBe(expected.waterMask);
    expect(result.tiles).toBe(expected.tiles);
    expect(result.vertices).toBe(expected.vertices);
    expect(result.albedoDistinct).toBe(expected.albedoDistinctValues);
  });

  it('is not affected by how the run is sharded', () => {
    // The verification page splits the set across a pool of workers. That is a
    // property of the runner; if it could reach a hash, the committed value
    // would depend on how many cores the machine had.
    const whole = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
    const ids = whole.map((r) => r.id);
    const sharded = [
      ...runFixtures(tsGenerator(), { size: QUICK_FIXTURES, ids: ids.filter((_, i) => i % 2 === 0) }),
      ...runFixtures(tsGenerator(), { size: QUICK_FIXTURES, ids: ids.filter((_, i) => i % 2 === 1) }),
    ];
    const byId = new Map(sharded.map((r) => [r.id, r]));
    expect(ids.map((id) => byId.get(id))).toEqual(whole);
  });

  it('rejects an unknown fixture id rather than silently running fewer', () => {
    expect(() => runFixtures(tsGenerator(), { size: QUICK_FIXTURES, ids: ['nope'] })).toThrow(
      /unknown fixture id/,
    );
  });

  it('reports the water mask as all zero, and means it', () => {
    // Phase 0 is airless, so this buffer is a constant and its hash is coverage
    // of nothing. The flag is what stops that reading as coverage — and this
    // assertion is what stops the flag becoming a lie when Phase 2 lands.
    const results = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
    for (const r of results) {
      expect(r.waterMaskAllZero, `fixture '${r.id}' water mask is no longer all zero`).toBe(true);
    }
    // Identical hashes across worlds is the visible consequence, and a useful
    // thing for a reader of the manifest to notice.
    expect(new Set(results.map((r) => r.waterMask)).size).toBe(1);
    for (const entry of Object.values(MANIFEST.fixtures)) {
      expect(entry.waterMaskAllZero).toBe(true);
    }
  });

  it('REPORTS THE ALBEDO AS VARIED, AND MEANS THAT TOO', () => {
    // The water mask above is the shape of the trap this one is written
    // against. Its hash is a hash of a constant, which is harmless because the
    // manifest records that in a flag and this suite checks the flag.
    //
    // Albedo is the same hash with the flag pointing the other way, and it is
    // far easier to break: a province field too coarse to vary inside a tile, a
    // per-world offset that never reached the buffer, a quantisation that
    // flattened the range. Each of those produces a buffer that hashes
    // perfectly, matches on every platform, and is worth nothing. So the
    // manifest records how many distinct values each fixture produced, and this
    // asserts it against the real buffer in both directions.
    const results = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
    for (const r of results) {
      expect(r.albedoDistinct, `fixture '${r.id}' albedo is nearly constant`).toBeGreaterThan(40);
    }
    // Unlike the water mask, no two worlds may share this hash. Ten identical
    // albedo hashes is the failure, and it should be impossible to commit.
    expect(new Set(results.map((r) => r.albedo)).size).toBe(results.length);
    for (const [id, entry] of Object.entries(MANIFEST.fixtures)) {
      expect(entry.albedoDistinctValues, `manifest fixture '${id}'`).toBeGreaterThan(40);
    }
    expect(new Set(Object.values(MANIFEST.fixtures).map((e) => e.albedo)).size).toBe(
      Object.keys(MANIFEST.fixtures).length,
    );
  });

  it('discriminates: a perturbed kernel turns the fixtures red', () => {
    // The whole artefact is worthless if it would pass regardless. A one-ulp
    // perturbation of a single elevation is far smaller than any real kernel
    // change, and it must still be caught.
    const results = runFixtures(perturbedGenerator(1), { size: QUICK_FIXTURES });
    const clean = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
    expect(results[0]!.elevation).not.toBe(clean[0]!.elevation);
    expect(fixturesDigest(results)).not.toBe(fixturesDigest(clean));
  });

  it('discriminates: a generator that ignores its tile id turns the fixtures red', () => {
    const clean = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
    const results = runFixtures(sameTileGenerator(), { size: QUICK_FIXTURES });
    expect(results[0]!.elevation).not.toBe(clean[0]!.elevation);
  });

  it('discriminates: a generator that ignores the world spec turns the fixtures red', () => {
    const clean = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
    const results = runFixtures(sameWorldGenerator(), { size: QUICK_FIXTURES });
    // Every fixture would collapse onto the first world's output.
    expect(results.map((r) => r.elevation).slice(1)).not.toEqual(
      clean.map((r) => r.elevation).slice(1),
    );
  });
});

describe('fixture manifest comparison', () => {
  const results = runFixtures(tsGenerator(), { size: QUICK_FIXTURES });
  const manifest = buildFixtureManifest(
    GEN_VERSION,
    'spec-hash',
    QUICK_FIXTURES.n,
    results,
    fixturesDigest(results),
  );

  it('passes a clean run', () => {
    expect(compareFixtureManifest(manifest, results)).toEqual([]);
    expect(formatFixtureMismatches([])).toContain('All fixture hashes match');
  });

  it('names the buffer that differs', () => {
    const broken = results.map((r, i) => (i === 1 ? { ...r, materials: 'deadbeef' } : r));
    const mismatches = compareFixtureManifest(manifest, broken);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      fixture: results[1]!.id,
      buffer: 'materials',
      reason: 'differs',
    });
    expect(formatFixtureMismatches(mismatches)).toContain('materials');
  });

  it('names the albedo buffer too, and not by accident of ordering', () => {
    // A buffer added to the manifest but not to the comparison loop would be a
    // hash that is written and never read — recorded, diffed by nobody, and
    // green whatever it holds.
    const broken = results.map((r, i) => (i === 0 ? { ...r, albedo: 'deadbeef' } : r));
    const mismatches = compareFixtureManifest(manifest, broken);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ buffer: 'albedo', reason: 'differs' });
  });

  it('NAMES THE SPEC, AND SAYS IT IS A DIFFERENT WORLD RATHER THAN A DIFFERENT HASH', () => {
    // The failure this reports is categorically unlike the others: every buffer
    // below it differs *correctly*, because the fixture is no longer the world
    // the manifest pinned. Reported as four buffer differences it reads as a
    // determinism regression, which is the most expensive wrong diagnosis this
    // repo can produce.
    const broken = results.map((r, i) => (i === 0 ? { ...r, specHash: 'deadbeef' } : r));
    const mismatches = compareFixtureManifest(manifest, broken);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ buffer: '(spec)', reason: 'spec' });
    expect(formatFixtureMismatches(mismatches)).toContain('different world');
  });

  it('reports a fixture that vanished from the run', () => {
    const mismatches = compareFixtureManifest(manifest, results.slice(1));
    expect(mismatches).toEqual([
      expect.objectContaining({ fixture: results[0]!.id, reason: 'missing-from-run' }),
    ]);
  });

  it('reports a fixture the manifest has never seen', () => {
    const mismatches = compareFixtureManifest(manifest, [
      ...results,
      { ...results[0]!, id: 'brand-new' },
    ]);
    expect(mismatches).toEqual([
      expect.objectContaining({ fixture: 'brand-new', reason: 'missing-from-manifest' }),
    ]);
  });

  it('reports a shape change before blaming the hashes', () => {
    const broken = results.map((r, i) => (i === 0 ? { ...r, tiles: r.tiles - 1 } : r));
    const mismatches = compareFixtureManifest(manifest, broken);
    expect(mismatches[0]).toMatchObject({ buffer: '(shape)', reason: 'shape' });
  });
});

describe('fixture manifest preflight', () => {
  const base: FixtureManifest = {
    genVersion: '0.1.0',
    fixtureSpecHash: 'abc',
    fixtureN: FIXTURE_N,
    tileCount: FIXTURE_TILES.length,
    digest: 'digest',
    fixtures: {},
  };

  it('lets a matching run through', () => {
    expect(fixtureManifestPreflight(base, '0.1.0', 'abc', FIXTURE_N)).toBeUndefined();
  });

  it('stops a generator-version mismatch, and says which', () => {
    expect(fixtureManifestPreflight(base, '0.2.0', 'abc', FIXTURE_N)).toMatch(/0\.1\.0.*0\.2\.0/);
  });

  it('stops a fixture-spec mismatch', () => {
    expect(fixtureManifestPreflight(base, '0.1.0', 'xyz', FIXTURE_N)).toMatch(/fixture specs/);
  });

  it('stops a quick run being compared against a full manifest', () => {
    // The cheap way to make a slow cell fast, refused at the door.
    expect(fixtureManifestPreflight(base, '0.1.0', 'abc', QUICK_FIXTURES.n)).toMatch(/n=/);
    expect(FULL_FIXTURES.n).not.toBe(QUICK_FIXTURES.n);
  });
});

// --- sabotaged generators, for the discrimination tests -----------------

function wrap(mutate: (tile: TileData, tileId: number, world: World) => void): TileGenerator {
  const inner = new TsTileGenerator(GEN_VERSION);
  return {
    genVersion: inner.genVersion,
    kind: inner.kind,
    generate(tileId: number, world: World, n: number, out?: TileGenOutput): TileData {
      const tile = inner.generate(tileId, world, n, out);
      mutate(tile, tileId, world);
      return tile;
    },
  };
}

/** Nudges one elevation by `ulps`. The smallest change the manifest must still catch. */
function perturbedGenerator(ulps: number): TileGenerator {
  return wrap((tile) => {
    const v = tile.elevation[0]!;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, v);
    buf.setBigUint64(0, buf.getBigUint64(0) + BigInt(ulps));
    tile.elevation[0] = buf.getFloat64(0);
  });
}

/** Generates the same tile whatever it is asked for. */
function sameTileGenerator(): TileGenerator {
  const inner = new TsTileGenerator(GEN_VERSION);
  return {
    genVersion: inner.genVersion,
    kind: inner.kind,
    generate: (tileId, world, n, out) => inner.generate(FIXTURE_TILES[0]!, world, n, out),
  };
}

/** Ignores the fixture's spec and seed. */
function sameWorldGenerator(): TileGenerator {
  const inner = new TsTileGenerator(GEN_VERSION);
  const only = FIXTURES[0]!.world;
  return {
    genVersion: inner.genVersion,
    kind: inner.kind,
    generate: (tileId, _world, n, out) => inner.generate(tileId, only, n, out),
  };
}
