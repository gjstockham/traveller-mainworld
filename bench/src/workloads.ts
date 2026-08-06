/**
 * The workloads Spike B measures.
 *
 * Fixed here rather than inline in each benchmark, so that the single-thread
 * figure, the pool throughput figure and the memory figure are all describing
 * the same tile. A throughput number measured on a cheaper tile than the
 * latency number is not comparable to it, and the two would end up in adjacent
 * columns of the same table.
 */
import {
  type FbmParams,
  type TileGenOutput,
  type World,
  allocateTileOutput,
  interpretText,
  makeTileId,
} from '@traveller-mainworld/core';

/**
 * The UPP the benchmark world's non-terrain fields come from.
 *
 * The benchmark measures a Size-8 world (the spike plan's navigation target),
 * but at 6371 km and 8000 m of relief — real Earth rather than the Cepheus
 * Size 8 figures. Those two overrides stay, because the R13 budgets were
 * measured against them; everything else the spec gained in WP9 comes from
 * interpreting an airless Size 8 UPP, so there is one place rules knowledge
 * lives and it is not here.
 */
const SYNTHETIC_UPP = 'X800000-0';

/**
 * Terrain parameters for the representative Phase-1 tile: **10 octaves**, per
 * the spike plan §B.1.
 *
 * Not `DEFAULT_FBM`, which is 8. The extra two octaves are the deepest LOD
 * levels' worth of detail, and since octave count is keyed to depth the deepest
 * tiles are the ones that have to fit the budget.
 */
export const BENCH_FBM: FbmParams = Object.freeze({
  octaves: 10,
  frequency: 1.6,
  amplitude: 1,
  lacunarity: 2.0,
  gain: 0.5,
});

/** A Size-8 world, the spike plan's navigation target. */
export const BENCH_WORLD: World = Object.freeze({
  spec: {
    ...interpretText(SYNTHETIC_UPP),
    radiusKm: 6371,
    terrainAmplitudeM: 8000,
    fbm: BENCH_FBM,
  },
  seedHi: 0xdeadbeef,
  seedLo: 0x12345678,
});

/**
 * The benchmark world with its crater density overridden.
 *
 * The other arm of the density differential in `tile.ts`. Everything else is
 * {@link BENCH_WORLD} to the field, so the difference between two runs is
 * attributable to the crater population and to nothing else — which is the only
 * way to say what a saturation cap would actually buy.
 *
 * At `0` the acceptance test rejects every candidate (`hashToUnit(h) >= 0` is
 * always true), so no crater and no basin survives while the lattice walk, the
 * per-candidate hash and the regolith pass all still run. That is the point:
 * the difference is the cost of the craters, not the cost of the machinery that
 * looks for them.
 */
export function worldAtDensity(densityScale: number): World {
  return Object.freeze({
    ...BENCH_WORLD,
    spec: {
      ...BENCH_WORLD.spec,
      craters: { ...BENCH_WORLD.spec.craters, densityScale },
    },
  });
}

/**
 * Crater density the benchmark UPP interprets to.
 *
 * `X800000-0` is Atmosphere 0, which is the **most expensive** crater field the
 * ruleset produces — a saturated airless surface. That is the right world for a
 * budget check and the wrong one for a typical-case number, so the density
 * sweep in the results reports the curve rather than one point on it.
 */
export const BENCH_DENSITY = BENCH_WORLD.spec.craters.densityScale;

/** The two grid resolutions open question 1 is between. */
export const GRID_SIZES = Object.freeze([64, 128]);

/**
 * One tile per face at a given quadtree depth.
 *
 * {@link benchTiles} spreads over depths and averages them, which is the right
 * shape for a headline figure and hides the thing WP15 has to know: the crater
 * band gate admits bands *with* depth, so a deep tile does strictly more work
 * than a shallow one. A budget met on an average of depths 0-6 is not a budget
 * met on the tiles a user zoomed in to see.
 */
export function tilesAtDepth(depth: number): number[] {
  const tiles: number[] = [];
  for (let face = 0; face < 6; face++) {
    let path = 0;
    for (let d = 0; d < depth; d++) {
      path = path * 4 + ((face + d) % 4);
    }
    tiles.push(makeTileId(face, depth, path));
  }
  return tiles;
}

/** Vertices in a `(n+1)²` grid. */
export function vertexCount(n: number): number {
  return (n + 1) * (n + 1);
}

/**
 * A spread of tiles across faces and depths.
 *
 * Depth matters to the measurement even though every tile does the same amount
 * of arithmetic: a deep tile samples a tiny patch of the noise field, so its
 * lattice coordinates are tightly clustered and its memory access pattern is
 * quite unlike a depth-0 tile spanning a whole face. Benchmarking one depth
 * would measure one cache behaviour and call it the tile cost.
 */
export function benchTiles(count = 24): number[] {
  const tiles: number[] = [];
  for (let i = 0; i < count; i++) {
    const face = i % 6;
    const depth = i % 7;
    let path = 0;
    for (let d = 0; d < depth; d++) {
      path = path * 4 + ((face + d + i) % 4);
    }
    tiles.push(makeTileId(face, depth, path));
  }
  return tiles;
}

/**
 * Scratch buffers per grid resolution, matching how the viewer's worker pools
 * them.
 *
 * Allocating inside the timed region would measure the allocator as much as the
 * kernel, and would measure it *differently* for the two grid sizes — a 129²
 * tile's 3.9 MB of directions is large enough to take a different path through
 * V8's heap than a 65² tile's 1 MB.
 */
export function scratchFor(n: number, cache = new Map<number, TileGenOutput>()): TileGenOutput {
  let s = cache.get(n);
  if (s === undefined) {
    s = allocateTileOutput(n);
    cache.set(n, s);
  }
  return s;
}

/** Bytes one tile's raw kernel output occupies, exactly. */
export function tileBytes(n: number): {
  elevation: number;
  waterMask: number;
  materials: number;
  directions: number;
  total: number;
} {
  const v = vertexCount(n);
  const elevation = v * 8;
  const waterMask = v;
  const materials = v;
  const directions = v * 3 * 8;
  return {
    elevation,
    waterMask,
    materials,
    directions,
    total: elevation + waterMask + materials + directions,
  };
}

/**
 * Bytes the *renderer-ready* form occupies: interleaved Float32 positions and
 * colours, with skirt vertices.
 *
 * This is what actually crosses the worker boundary and what actually sits in
 * the LRU, so it is the number the cache should be sized from. The raw Float64
 * output never leaves the worker.
 */
export function renderBytes(n: number): number {
  // Matches `viewer/src/mesh/tileMesh.ts`: the grid plus eight skirt rings —
  // a top-of-wall and a bottom-of-wall ring for each of the four edges.
  const verts = vertexCount(n) + 8 * (n + 1);
  return verts * 3 * 4 * 2;
}
