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
  type Fixture,
  FIXTURES,
  type TileGenOutput,
  type TileGenerator,
  allocateTileOutput,
  canonicalBytes,
  canonicalBytesU8,
  makeTileId,
  serialiseSpec,
  sha256Hex,
  specHash,
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

/**
 * The fixture worlds themselves live in `core`.
 *
 * Re-exported here because this module is where the harness talks about them,
 * but they are defined next to `PhysicalWorldSpec` so the viewer can render the
 * same objects the manifest pins — see `packages/core/src/fixtures.ts`. A second
 * copy would mean "I flew a fixture" and "that fixture is hashed" were claims
 * about different data.
 */
export type { Fixture } from '@traveller-mainworld/core';
export { FIXTURES } from '@traveller-mainworld/core';


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
  /**
   * SHA-256 of the interpreted spec this fixture generated from (plan §4.3).
   *
   * The aggregate {@link fixtureSpecHash} is what the preflight refuses on, and
   * it says *that* the fixture inputs moved. This says **which**: with one hash
   * per fixture in the committed manifest, a `git diff fixtures.json` after a
   * ruleset change is a list of the worlds that changed and the worlds that did
   * not, which is the only thing that can separate a table edit from a kernel
   * change when both would move every buffer hash below.
   */
  readonly specHash: string;
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
  /**
   * SHA-256 over every tile's albedo bytes (WP11).
   *
   * **A constant buffer would hash perfectly and prove nothing**, in exactly the
   * way {@link FixtureResult.waterMask} does — and albedo is far easier to get
   * wrong that way than a water pass that does not exist yet: a palette offset
   * that never reaches the buffer, a province field too coarse to vary within a
   * tile, a quantisation that flattens the range. So this hash travels with
   * {@link FixtureResult.albedoDistinct}, which records the opposite claim from
   * the water mask's flag: not that the buffer *is* constant, but by how much it
   * is not.
   *
   * ## This pins the byte, not the scalar behind it — decided in WP14
   *
   * `elevation` is hashed as `Float64`, so what CI asserts about it is the
   * arithmetic, to the last bit. Albedo is hashed **after `quantiseAlbedo`**,
   * and one byte is 1/255. Reordering a float sum moves the scalar by ~1e-16,
   * about 4e-14 of a byte, so a compositing-order change that would redden
   * `elevation` instantly is invisible here for every value except one landing
   * within 1e-16 of a rounding boundary.
   *
   * That is not a defect and it is not a promise either, so it is written down
   * as neither: **the claim this hash makes is "the byte is stable", and it is
   * exactly as strong as that sounds.** `regolith.ts` says the canonical
   * compositing order buys albedo nothing at byte resolution rather than
   * implying a guarantee it does not provide, and `regolith.test.ts` asserts
   * that insensitivity directly, in both directions, against the float. Pinning
   * the scalar instead was considered and rejected: it would mint a second
   * hashed buffer of a quantity nothing renders, to catch a class of change
   * that `elevation` already catches on the same tile in the same run.
   *
   * The thing to know before trusting it: an albedo change smaller than 1/255
   * everywhere is a change this manifest will call clean.
   */
  readonly albedo: string;
  /** Tiles evaluated. */
  readonly tiles: number;
  /** Vertices per buffer, across the whole tile set. */
  readonly vertices: number;
  /** Whether the water mask really was all zeros. See {@link FixtureResult.waterMask}. */
  readonly waterMaskAllZero: boolean;
  /** Distinct albedo byte values across the run. See {@link FixtureResult.albedo}. */
  readonly albedoDistinct: number;
}

/** Reusable buffers, so a ten-fixture run does not allocate ten times. */
export interface FixtureScratch {
  readonly tile: TileGenOutput;
  readonly elevation: Float64Array;
  readonly waterMask: Uint8Array;
  readonly materials: Uint8Array;
  readonly albedo: Uint8Array;
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
    albedo: new Uint8Array(total),
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
    scratch.albedo.set(tile.albedo.subarray(0, per), offset);
    offset += per;
  }

  const elevation = scratch.elevation.subarray(0, offset);
  const waterMask = scratch.waterMask.subarray(0, offset);
  const materials = scratch.materials.subarray(0, offset);
  const albedo = scratch.albedo.subarray(0, offset);

  let waterMaskAllZero = true;
  for (let i = 0; i < waterMask.length; i++) {
    if (waterMask[i] !== 0) {
      waterMaskAllZero = false;
      break;
    }
  }

  // A 256-entry tally rather than a `Set`: the domain is a byte, and this runs
  // over a million and a half values per fixture.
  const seen = new Uint8Array(256);
  let albedoDistinct = 0;
  for (let i = 0; i < albedo.length; i++) {
    if (seen[albedo[i]!] === 0) {
      seen[albedo[i]!] = 1;
      albedoDistinct++;
    }
  }

  return {
    id: fixture.id,
    specHash: specHash(fixture.world.spec),
    elevation: sha256Hex(canonicalBytes(elevation)),
    waterMask: sha256Hex(canonicalBytesU8(waterMask)),
    materials: sha256Hex(canonicalBytesU8(materials)),
    albedo: sha256Hex(canonicalBytesU8(albedo)),
    tiles: tiles.length,
    vertices: offset,
    waterMaskAllZero,
    albedoDistinct,
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
 * ## What WP14 added, and what it is the enforcement for
 *
 * Until WP14 this listed the ten spec fields that reached generation, and an
 * exclusion list in `fixtures.test.ts` carried the rest with the phase that
 * would consume each. That was right while the specs were hand-written, and
 * wrong once they were interpreted: the thing that decides a fixture is no
 * longer the spec, it is the **`(UPP, ruleset, seed)` triple**, and the spec is
 * what the interpreter makes of it.
 *
 * So all three appear here, and the whole interpreted spec with them, through
 * `core`'s own `serialiseSpec` — plan §4.3's spec hashing, which is the
 * enforcement for R7. A `cepheus-1` table edit now moves this hash, and
 * `fixtureManifestPreflight` refuses the comparison **before a single tile is
 * generated**, naming the fixture set rather than reporting forty changed
 * buffer hashes. A one-digit table edit silently changing every world anyone
 * has ever shared is the risk in plan §13 this closes.
 *
 * Two consequences worth stating rather than discovering:
 *
 * - **A field that reaches no tile is now hashed anyway.** `atmosphere.*` and
 *   the climate hints are Phase 2 and Phase 4 work, and editing one today moves
 *   this hash while every buffer hash stays put. That is the intended reading:
 *   the fixture identity is what the interpreter produced, not the subset the
 *   current phase happens to consume, and a table edit that will change worlds
 *   two phases from now should be a protocol event on the day it is made.
 * - **`serialiseSpec` is the single copy.** A field added to
 *   `PhysicalWorldSpec` and not added there is hashed as though it did not
 *   exist — which `packages/core/test/serialise.test.ts` turns into a red test
 *   by walking the spec's own leaves, and which `fixtures.test.ts` checks again
 *   from this side.
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
    lines.push(
      `fixture=${f.id}`,
      `  upp=${f.upp}`,
      `  ruleset=${f.rulesetId}`,
      `  seedHi=${String(f.world.seedHi >>> 0)}`,
      `  seedLo=${String(f.world.seedLo >>> 0)}`,
      // The interpreted spec, one leaf per line, in `serialiseSpec`'s fixed
      // order. Prefixed rather than inlined so a reader of this text can see
      // which lines are the input and which are what the ruleset made of it.
      ...serialiseSpec(f.world.spec)
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => `  spec.${line}`),
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
    .map(
      (r) =>
        `${r.id}:elevation:${r.elevation}:waterMask:${r.waterMask}:materials:${r.materials}` +
        `:albedo:${r.albedo}`,
    )
    .join('\n');
  return sha256Hex(asciiBytes(joined));
}
