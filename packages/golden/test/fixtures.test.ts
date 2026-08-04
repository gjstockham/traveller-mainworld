import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FACE_COUNT,
  GEN_VERSION,
  type TileData,
  type TileGenOutput,
  type TileGenerator,
  TsTileGenerator,
  type World,
  leafPaths,
  tileBounds,
  tileDepth,
  tileFace,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

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

  it('varies the generator inputs, not just the seed', () => {
    // A set that left fBm at its default would hash ten worlds differing only
    // in radius and seed, and would not discriminate a change to how gain,
    // lacunarity or octave count are consumed.
    const distinct = (pick: (w: World) => number): number =>
      new Set(FIXTURES.map((f) => pick(f.world))).size;
    expect(distinct((w) => w.spec.fbm.octaves)).toBeGreaterThanOrEqual(8);
    expect(distinct((w) => w.spec.fbm.gain)).toBeGreaterThanOrEqual(4);
    expect(distinct((w) => w.spec.fbm.lacunarity)).toBeGreaterThanOrEqual(3);
    expect(distinct((w) => w.spec.fbm.frequency)).toBeGreaterThanOrEqual(8);

    // The awkward seed lanes, which a mixer is most likely to collapse.
    const seeds = FIXTURES.map((f) => [f.world.seedHi >>> 0, f.world.seedLo >>> 0] as const);
    expect(seeds).toContainEqual([0, 0]);
    expect(seeds).toContainEqual([0xffffffff, 0xffffffff]);
    expect(seeds.some(([hi]) => hi === 0x80000000)).toBe(true);
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
 * Fields of `PhysicalWorldSpec` that the fixture-spec hash deliberately does
 * not cover, each with the phase that will change that.
 *
 * WP9 grew the spec to PRD R5's full field set — atmosphere, hydrographics,
 * derived hints, crater parameters — while `serialiseFixtureSpecs` still names
 * the three things Phase 0 generation reads. That is correct *today*: none of
 * these reaches `generateTile`, so hashing them would move the fixture-spec
 * hash for inputs no generator consumes.
 *
 * It stops being correct the moment one of them does. WP10 reads
 * `craters.*`; Phase 2 reads `hydrographicCoverage` and `atmosphere.*`. A
 * field that reaches generation without reaching this hash is a fixture set
 * that cannot tell two different worlds apart — so the list below is an
 * obligation, not a note, and the test under it fails on any spec field that
 * is neither serialised nor listed here.
 */
const NOT_YET_GENERATED: Readonly<Record<string, string>> = {
  surfaceGravityG: 'stored only; WP10 uses it via craters.transitionDiameterKm',
  'atmosphere.pressureBand': 'Phase 2 (sky)',
  'atmosphere.pressureBar': 'Phase 2 (sky)',
  'atmosphere.composition': 'Phase 2 (sky, surface tinting)',
  hydrographicCoverage: 'Phase 2 (R8 sea-level solve)',
  'hints.temperatureBand': 'Phase 4 (climate)',
  'hints.iceLikelihood': 'Phase 4 (climate)',
  'hints.terrainRoughness': 'derived from radiusKm and terrainAmplitudeM, both hashed',
  'craters.densityScale': 'WP10',
  'craters.transitionDiameterKm': 'WP10',
  'craters.regolithMaturity': 'WP10, WP11',
};

describe('the fixture-spec hash covers the whole spec', () => {
  const spec = FIXTURES[0]!.world.spec;
  const serialised = serialiseFixtureSpecs();

  it('serialises, or explicitly excuses, every field of PhysicalWorldSpec', () => {
    const unaccounted = leafPaths(spec).filter(
      (path) => !serialised.includes(`${path}=`) && NOT_YET_GENERATED[path] === undefined,
    );
    expect(
      unaccounted,
      'A field was added to PhysicalWorldSpec without deciding whether the fixture-spec ' +
        'hash covers it. Add it to serialiseFixtureSpecs (a fixture-spec change under the ' +
        'change protocol) or to NOT_YET_GENERATED with the phase that will.',
    ).toEqual([]);
  });

  it('does not excuse a field it actually serialises', () => {
    // The other direction: an entry left in NOT_YET_GENERATED after the field
    // it names started being hashed would be a stale claim in a file people
    // read to find out what is covered.
    const stale = Object.keys(NOT_YET_GENERATED).filter((path) =>
      serialised.includes(`${path}=`),
    );
    expect(stale).toEqual([]);
  });

  it('names a real field in every excuse', () => {
    const leaves = new Set(leafPaths(spec));
    expect(Object.keys(NOT_YET_GENERATED).filter((path) => !leaves.has(path))).toEqual([]);
  });
});

describe('running fixtures', () => {
  it('reproduces the committed hashes for a full-size fixture', () => {
    // One fixture at the real size, not the whole set: each fixture's hashes are
    // independent, so this is a genuine comparison against the committed
    // artefact at a tenth of the cost. `pnpm golden:verify` does all ten.
    const fixture = FIXTURES[0]!;
    const result = runFixture(tsGenerator(), fixture);
    const expected = MANIFEST.fixtures[fixture.id]!;
    expect(result.elevation).toBe(expected.elevation);
    expect(result.materials).toBe(expected.materials);
    expect(result.waterMask).toBe(expected.waterMask);
    expect(result.tiles).toBe(expected.tiles);
    expect(result.vertices).toBe(expected.vertices);
  }, 30_000);

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
