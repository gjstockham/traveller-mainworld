/**
 * The golden fixture worlds (implementation plan §7.1).
 *
 * The determinism battery in `battery.ts` measures *kernel functions* over
 * hostile inputs. This module measures the other thing: whole generated tiles
 * of whole worlds, through the same `TileGenerator` the viewer ships, hashed
 * per output buffer. A kernel function can be bit-stable while the composition
 * of them into a tile is not — a mis-ordered buffer write, a spec field read at
 * the wrong moment, a tile-bounds arithmetic slip — and this is what catches
 * that.
 *
 * The two artefacts are kept separate on purpose. See `fixtureManifest.ts` for
 * why, and for what `genVersion` does and does not cover.
 *
 * Platform-neutral: this module runs unchanged in Node, in the browser
 * verification page and in every matrix cell. Nothing here may import `node:*`
 * — `scripts/check-browser-battery.mjs` fails the lint if it does.
 */
import {
  type TileGenOutput,
  type TileGenerator,
  type World,
  allocateTileOutput,
  canonicalBytes,
  canonicalBytesU8,
  makeTileId,
  sha256Hex,
  tileToString,
} from '@traveller-mainworld/core';

/**
 * Grid resolution of every fixture tile; the vertex grid is `(n+1)²`.
 *
 * 128 gives the 129² grid the spike plan calls the representative Phase-1 tile
 * (§B.1), which is also the grid the R13 budgets were measured against in
 * ADR-0001 §E2 and the size `tile.composite` uses in the battery. Open question
 * 1 — 65² or 129² for the viewer's *mesh* — is a separate question: this pins
 * what the generator is hashed at, not what the renderer draws. If the mesh
 * lands at 65², the shipped path stops being the hashed path and this set
 * should grow a 65² arm under the change protocol.
 */
export const FIXTURE_N = 128;

/** Deepest fixture tile. Depths 0–6, per implementation plan §7.1. */
export const FIXTURE_MAX_DEPTH = 6;

/** One fixture world: a hand-written spec plus the seed that instantiates it. */
export interface Fixture {
  /** Stable key in the manifest. Part of the fixture-spec hash. */
  readonly id: string;
  /** Why this fixture is in the set. Prose only — deliberately *not* hashed. */
  readonly description: string;
  readonly world: World;
}

/**
 * Ten worlds spanning the size range (implementation plan §7.1).
 *
 * Phase 0 has no ruleset interpreter (PRD R5–R7, Phase 1), so these specs are
 * hand-written rather than derived from UPPs, and the radii are the Cepheus
 * size codes read literally — roughly `size × 800 km`. When the interpreter
 * lands, these get regenerated from real UPPs under the change protocol, which
 * is a fixture-spec change and nothing else: see `fixtureManifest.ts`.
 *
 * The fBm parameters are not decoration. They are generator inputs, so a
 * fixture set that left them at `DEFAULT_FBM` would hash ten worlds that
 * differed only in seed and radius, and would not discriminate a change to how
 * lacunarity, gain or octave count are consumed. So the set deliberately spans
 * gain either side of 0.5, non-dyadic lacunarity, and octave counts from a
 * handful up to `MAX_OCTAVES` — with one fixture holding `DEFAULT_FBM` exactly,
 * because the shipping default deserves to be pinned too.
 *
 * Seeds likewise cover the awkward lanes: all-zero, all-ones, the sign bit set,
 * and one either side of them.
 */
export const FIXTURES: readonly Fixture[] = Object.freeze([
  {
    id: 'size1-rockball',
    description: 'Smallest supported world. All-zero seed — the lane a mixer is most likely to collapse.',
    world: {
      spec: {
        radiusKm: 800,
        terrainAmplitudeM: 24000,
        fbm: { octaves: 6, frequency: 0.8, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0x00000000,
      seedLo: 0x00000000,
    },
  },
  {
    id: 'size2-cinder',
    description: 'Low gain: amplitude decays fast, so the deep octaves contribute near-nothing.',
    world: {
      spec: {
        radiusKm: 1600,
        terrainAmplitudeM: 30000,
        fbm: { octaves: 8, frequency: 1.2, amplitude: 1, lacunarity: 2, gain: 0.45 },
      },
      seedHi: 0x00000000,
      seedLo: 0x00000001,
    },
  },
  {
    id: 'size3-ceres',
    description: 'All-ones seed, the other end of the lane range.',
    world: {
      spec: {
        radiusKm: 2400,
        terrainAmplitudeM: 28000,
        fbm: { octaves: 10, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0xffffffff,
      seedLo: 0xffffffff,
    },
  },
  {
    id: 'size4-luna',
    description: 'Gain above 0.5 with high base frequency: rough terrain, wide elevation range.',
    world: {
      spec: {
        radiusKm: 3200,
        terrainAmplitudeM: 26000,
        fbm: { octaves: 12, frequency: 2.2, amplitude: 1, lacunarity: 2, gain: 0.55 },
      },
      seedHi: 0x80000000,
      seedLo: 0x00000000,
    },
  },
  {
    id: 'size5-mercury',
    description: 'Non-dyadic lacunarity — octave frequencies stop being exactly representable.',
    world: {
      spec: {
        radiusKm: 4000,
        terrainAmplitudeM: 22000,
        fbm: { octaves: 9, frequency: 1.9, amplitude: 1, lacunarity: 1.87, gain: 0.5 },
      },
      seedHi: 0x7fffffff,
      seedLo: 0xffffffff,
    },
  },
  {
    id: 'size6-mars',
    description: 'High gain and many octaves together: the largest fBm sums in the set.',
    world: {
      spec: {
        radiusKm: 4800,
        terrainAmplitudeM: 21000,
        fbm: { octaves: 14, frequency: 2.5, amplitude: 1, lacunarity: 2, gain: 0.6 },
      },
      seedHi: 0xdeadbeef,
      seedLo: 0x12345678,
    },
  },
  {
    id: 'size7-temperate',
    description: 'Non-dyadic lacunarity again, paired with low gain and an odd octave count.',
    world: {
      spec: {
        radiusKm: 5600,
        terrainAmplitudeM: 16000,
        fbm: { octaves: 11, frequency: 3.1, amplitude: 1, lacunarity: 2.13, gain: 0.42 },
      },
      seedHi: 0x0badf00d,
      seedLo: 0xcafebabe,
    },
  },
  {
    id: 'size8-earthlike',
    description: 'DEFAULT_FBM exactly, at Earth radius: the shipping default, pinned.',
    world: {
      spec: {
        radiusKm: 6400,
        terrainAmplitudeM: 8000,
        fbm: { octaves: 8, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0x9e3779b1,
      seedLo: 0x85ebca6b,
    },
  },
  {
    id: 'size9-large',
    description: 'Subdued relief on a large radius — the regime where elevation is small next to the datum.',
    world: {
      spec: {
        radiusKm: 7200,
        terrainAmplitudeM: 7000,
        fbm: { octaves: 16, frequency: 4, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0x00000001,
      seedLo: 0x00000000,
    },
  },
  {
    id: 'sizeA-maximal',
    description: 'MAX_OCTAVES exactly — the last octave before fbm3 starts clamping.',
    world: {
      spec: {
        radiusKm: 8000,
        terrainAmplitudeM: 6000,
        fbm: { octaves: 24, frequency: 5.5, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0xa5a5a5a5,
      seedLo: 0x5a5a5a5a,
    },
  },
]);

/**
 * The fixed tile set, evaluated for every fixture.
 *
 * Implementation plan §7.1 asks for all six faces at depths 0–6, *deliberately
 * including face corners and edge-adjacent tiles*, because the tangent warp is
 * where a cube-sphere mapping bug shows first and the interior of a face is
 * where it shows last. `tile.composite` in the battery walks an arbitrary quad
 * path and reaches none of them; this set is built to.
 *
 * Per face:
 *
 * - **depth 0** — the face root.
 * - **depth 1** — all four children. Complete coverage at that depth, and the
 *   four of them are the four face corners at their coarsest.
 * - **depths 2–6** — a corner tile and an edge tile.
 *   - The corner tile repeats one child index all the way down, which pins it
 *     into a face corner: index 0 is `(u0, v0) = (0, 0)`, 3 is the far corner.
 *     Which corner cycles with depth *and* face, so all four corners of every
 *     face appear across the set rather than one corner appearing thirty times.
 *   - The edge tile alternates two child indices that agree on one axis: `0/2`
 *     keeps `u0 = 0`, hugging the face's `u` edge while `v` walks inward; `0/1`
 *     keeps `v0 = 0`. Which edge alternates with depth, so both orientations
 *     appear. Alternating rather than repeating is what keeps it *edge-adjacent
 *     but not a corner*, which is the case that a corner tile does not cover.
 *
 * That is 15 tiles per face, 90 per fixture, 900 across the set. The number is
 * a consequence of the coverage rule and nothing else — in particular it is not
 * tuned to fit a CI timeout. A slow cell is a runner to fix, because the moment
 * this count answers to a stopwatch the manifest stops meaning anything.
 */
export function buildFixtureTiles(maxDepth = FIXTURE_MAX_DEPTH): number[] {
  const tiles: number[] = [];

  for (let face = 0; face < 6; face++) {
    tiles.push(makeTileId(face, 0, 0));
    for (let child = 0; child < 4; child++) {
      tiles.push(makeTileId(face, 1, child));
    }

    for (let depth = 2; depth <= maxDepth; depth++) {
      const corner = (face + depth) % 4;
      // Alternate 0/2 (u0 stays 0) on even depths, 0/1 (v0 stays 0) on odd.
      const other = depth % 2 === 0 ? 2 : 1;

      let cornerPath = 0;
      let edgePath = 0;
      for (let level = 0; level < depth; level++) {
        cornerPath = cornerPath * 4 + corner;
        edgePath = edgePath * 4 + (level % 2 === 0 ? 0 : other);
      }

      tiles.push(makeTileId(face, depth, cornerPath));
      tiles.push(makeTileId(face, depth, edgePath));
    }
  }

  return tiles;
}

/** The tile set, built once. Order is part of the hash. */
export const FIXTURE_TILES: readonly number[] = Object.freeze(buildFixtureTiles());

/**
 * Sizes of one fixture run.
 *
 * Mirrors `BatterySize` in `battery.ts`, and for the same reason: there has to
 * be a way to exercise the runner without paying for the real thing, and it has
 * to be impossible to mistake one for the other. Only {@link FULL_FIXTURES}
 * produces hashes comparable to `fixtures.json`.
 */
export interface FixtureRunSize {
  /** Grid resolution per tile. */
  readonly n: number;
  /** Deepest tile in the set. */
  readonly maxDepth: number;
  /** How many fixtures, taken from the front of {@link FIXTURES}. */
  readonly fixtureCount: number;
}

/** What the committed `fixtures.json` was produced with. Not a tuning knob. */
export const FULL_FIXTURES: FixtureRunSize = Object.freeze({
  n: FIXTURE_N,
  maxDepth: FIXTURE_MAX_DEPTH,
  fixtureCount: FIXTURES.length,
});

/**
 * A reduced run, for developing the verification page and for the unit-suite
 * checks that only need the *shape* of a run — sharding equivalence, mismatch
 * reporting, discrimination against sabotaged generators.
 *
 * Its hashes are meaningless against `fixtures.json` and it must never be used
 * to produce one — `fixtureManifestPreflight` rejects the grid size outright,
 * so a quick run cannot be mistaken for a pass.
 */
export const QUICK_FIXTURES: FixtureRunSize = Object.freeze({
  n: 16,
  maxDepth: 2,
  fixtureCount: 3,
});

/** The concrete fixtures and tiles a run size selects. */
export function resolveFixtureRun(size: FixtureRunSize = FULL_FIXTURES): {
  fixtures: readonly Fixture[];
  tiles: readonly number[];
  n: number;
} {
  return {
    fixtures: FIXTURES.slice(0, size.fixtureCount),
    tiles: size.maxDepth === FIXTURE_MAX_DEPTH ? FIXTURE_TILES : buildFixtureTiles(size.maxDepth),
    n: size.n,
  };
}

/** Hashes of one fixture's output buffers, plus what they were computed over. */
export interface FixtureResult {
  readonly id: string;
  /** SHA-256 over the canonical little-endian bytes of every tile's elevation, in tile order. */
  readonly elevation: string;
  /**
   * SHA-256 over every tile's water mask.
   *
   * **Phase 0 is airless: this buffer is all zeros for every fixture**, so the
   * hash is a real hash of nothing and proves nothing about a water pass that
   * does not exist yet. {@link FixtureResult.waterMaskAllZero} records that as
   * data rather than leaving it to a comment, and `fixtures.test.ts` asserts
   * the flag against the actual buffer so it cannot quietly become a false
   * claim when Phase 2 lands.
   */
  readonly waterMask: string;
  /** SHA-256 over every tile's material classification. */
  readonly materials: string;
  /** Tiles evaluated. */
  readonly tiles: number;
  /** Vertices per buffer, across the whole tile set. */
  readonly vertices: number;
  /** Whether the water mask really was all zeros. See {@link FixtureResult.waterMask}. */
  readonly waterMaskAllZero: boolean;
}

/** Reusable buffers, so a ten-fixture run does not allocate ten times. */
export interface FixtureScratch {
  readonly tile: TileGenOutput;
  readonly elevation: Float64Array;
  readonly waterMask: Uint8Array;
  readonly materials: Uint8Array;
}

/** Allocate the buffers one fixture run needs. */
export function allocateFixtureScratch(
  n = FIXTURE_N,
  tileCount = FIXTURE_TILES.length,
): FixtureScratch {
  const total = (n + 1) * (n + 1) * tileCount;
  return {
    tile: allocateTileOutput(n),
    elevation: new Float64Array(total),
    waterMask: new Uint8Array(total),
    materials: new Uint8Array(total),
  };
}

/**
 * Generate one fixture's whole tile set and hash each output buffer.
 *
 * Buffers are hashed *separately* rather than as one interleaved stream (plan
 * §7.2). A single combined hash would say "something changed" where three say
 * which output changed, and elevation moving while materials do not is a very
 * different bug from the reverse.
 */
export function runFixture(
  generator: TileGenerator,
  fixture: Fixture,
  n = FIXTURE_N,
  tiles: readonly number[] = FIXTURE_TILES,
  scratch: FixtureScratch = allocateFixtureScratch(n, tiles.length),
): FixtureResult {
  const per = (n + 1) * (n + 1);
  let offset = 0;

  for (const tileId of tiles) {
    const tile = generator.generate(tileId, fixture.world, n, scratch.tile);
    if (tile.elevation.length < per) {
      throw new Error(
        `fixture '${fixture.id}' tile ${tileToString(tileId)} returned ${String(
          tile.elevation.length,
        )} elevations, expected at least ${String(per)}`,
      );
    }
    scratch.elevation.set(tile.elevation.subarray(0, per), offset);
    scratch.waterMask.set(tile.waterMask.subarray(0, per), offset);
    scratch.materials.set(tile.materials.subarray(0, per), offset);
    offset += per;
  }

  const elevation = scratch.elevation.subarray(0, offset);
  const waterMask = scratch.waterMask.subarray(0, offset);
  const materials = scratch.materials.subarray(0, offset);

  let waterMaskAllZero = true;
  for (let i = 0; i < waterMask.length; i++) {
    if (waterMask[i] !== 0) {
      waterMaskAllZero = false;
      break;
    }
  }

  return {
    id: fixture.id,
    elevation: sha256Hex(canonicalBytes(elevation)),
    waterMask: sha256Hex(canonicalBytesU8(waterMask)),
    materials: sha256Hex(canonicalBytesU8(materials)),
    tiles: tiles.length,
    vertices: offset,
    waterMaskAllZero,
  };
}

export interface FixtureRunOptions {
  readonly size?: FixtureRunSize;
  /**
   * Run only these fixture ids, in {@link FIXTURES} order.
   *
   * This is what lets the verification page shard a run across a pool of
   * workers: each fixture is an independent pure function of its own spec and
   * seed, so which worker evaluates it cannot reach the hash. Sharding is a
   * property of the runner; the set is not.
   */
  readonly ids?: readonly string[];
  readonly onProgress?: (result: FixtureResult, index: number, total: number) => void;
}

/** Run fixtures against one generator. */
export function runFixtures(
  generator: TileGenerator,
  options: FixtureRunOptions = {},
): FixtureResult[] {
  const { fixtures, tiles, n } = resolveFixtureRun(options.size);
  const wanted =
    options.ids === undefined
      ? fixtures
      : fixtures.filter((f) => options.ids!.includes(f.id));

  if (options.ids !== undefined && wanted.length !== options.ids.length) {
    const known = new Set(fixtures.map((f) => f.id));
    const unknown = options.ids.filter((id) => !known.has(id));
    throw new Error(`unknown fixture id(s): ${unknown.join(', ')}`);
  }

  const scratch = allocateFixtureScratch(n, tiles.length);
  const results: FixtureResult[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const result = runFixture(generator, wanted[i]!, n, tiles, scratch);
    results.push(result);
    options.onProgress?.(result, i, wanted.length);
  }
  return results;
}

/** Bytes of an ASCII string. Mirrors `batteryDigest`, and rejects anything that is not ASCII. */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(
        `fixture serialisation must be ASCII so its bytes are unambiguous; found U+${code
          .toString(16)
          .toUpperCase()} at ${String(i)}`,
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Canonical text form of the fixture *inputs* — everything that decides what
 * gets generated, and nothing that does not.
 *
 * Field order and formatting are fixed here rather than delegated to
 * `JSON.stringify`, because this string is a committed identity: it must not
 * change because a property was reordered in the literal above or because a
 * serialiser changed how it renders a number. `String(number)` is safe — the
 * ECMAScript number-to-string algorithm is exact and specified, so every engine
 * renders these identically.
 *
 * Descriptions are excluded deliberately. Fixing a typo in one is not a change
 * to what is generated, and should not cost a protocol event.
 */
export function serialiseFixtureSpecs(
  fixtures: readonly Fixture[] = FIXTURES,
  tiles: readonly number[] = FIXTURE_TILES,
  n = FIXTURE_N,
): string {
  const lines: string[] = [`n=${String(n)}`, `tiles=${tiles.map(String).join(',')}`];
  for (const f of fixtures) {
    const { spec } = f.world;
    lines.push(
      `fixture=${f.id}`,
      `  radiusKm=${String(spec.radiusKm)}`,
      `  terrainAmplitudeM=${String(spec.terrainAmplitudeM)}`,
      `  fbm.octaves=${String(spec.fbm.octaves)}`,
      `  fbm.frequency=${String(spec.fbm.frequency)}`,
      `  fbm.amplitude=${String(spec.fbm.amplitude)}`,
      `  fbm.lacunarity=${String(spec.fbm.lacunarity)}`,
      `  fbm.gain=${String(spec.fbm.gain)}`,
      `  seedHi=${String(f.world.seedHi >>> 0)}`,
      `  seedLo=${String(f.world.seedLo >>> 0)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Identity of the fixture set itself, independent of the kernel.
 *
 * This is the second key on `fixtures.json`, and the reason `genVersion` does
 * not have to cover fixture specs. Edit a radius and this moves; the diff shows
 * it, the change protocol demands a changelog entry naming it, and no phantom
 * generator version is minted for a change that altered output for no input any
 * user can reach. See `fixtureManifest.ts` for the full argument.
 */
export function fixtureSpecHash(
  fixtures: readonly Fixture[] = FIXTURES,
  tiles: readonly number[] = FIXTURE_TILES,
  n = FIXTURE_N,
): string {
  return sha256Hex(asciiBytes(serialiseFixtureSpecs(fixtures, tiles, n)));
}

/** Hash of the whole fixture run — one number to compare across platforms. */
export function fixturesDigest(results: readonly FixtureResult[]): string {
  const joined = results
    .map((r) => `${r.id}:elevation:${r.elevation}:waterMask:${r.waterMask}:materials:${r.materials}`)
    .join('\n');
  return sha256Hex(asciiBytes(joined));
}
