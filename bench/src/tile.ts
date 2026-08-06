/**
 * Single-tile generation: the number the kernel decision turns on.
 *
 * Spike B's budget is **≈100 ms per tile single-threaded** (§B.3), derived from
 * R13's "first interactive globe ≤ 10 s": the initial low-LOD shell is 24-96
 * tiles, and four workers clear that inside ten seconds if a tile costs about a
 * tenth of a second. A miss by less than 2× says optimise the TypeScript; a
 * miss by 2× or more says switch kernels on performance grounds.
 */
import {
  type BasinField,
  type TileGenOutput,
  type TileGenerator,
  TsTileGenerator,
  bandsForDepth,
  buildBasins,
} from '@traveller-mainworld/core';

import { type Timing, time } from './harness.js';
import {
  BENCH_WORLD,
  benchTiles,
  scratchFor,
  tilesAtDepth,
  vertexCount,
  worldAtDensity,
} from './workloads.js';

export interface TileBenchRow {
  readonly kernel: string;
  readonly n: number;
  /** Grid vertices per tile. */
  readonly vertices: number;
  readonly timing: Timing;
  /** Nanoseconds per grid vertex — the figure that compares grid sizes fairly. */
  readonly nsPerVertex: number;
}

/**
 * Time `generate` over a spread of tiles.
 *
 * One iteration generates every tile in the set, so the reported per-op figure
 * is a per-tile average over faces and depths rather than one tile's luck. A
 * single tile timed repeatedly would sit entirely in L2 after the first pass
 * and report a cost the streaming pipeline never sees.
 */
export function benchTileGeneration(
  generator: TileGenerator,
  n: number,
  iterations: number,
): TileBenchRow {
  const tiles = benchTiles();
  const cache = new Map<number, TileGenOutput>();
  const out = scratchFor(n, cache);

  const timing = time(
    `${generator.kind} n=${n}`,
    () => {
      let acc = 0;
      for (const id of tiles) {
        const tile = generator.generate(id, BENCH_WORLD, n, out);
        // Reading one value back keeps the whole generate call observable.
        acc += tile.elevation[0]!;
      }
      return acc;
    },
    { iterations, opsPerIteration: tiles.length },
  );

  const vertices = vertexCount(n);
  return {
    kernel: generator.kind,
    n,
    vertices,
    timing,
    nsPerVertex: (timing.msPerOp * 1e6) / vertices,
  };
}

export interface DensityBenchRow {
  readonly n: number;
  readonly densityScale: number;
  readonly timing: Timing;
  /**
   * Sum of one elevation per tile, over the last iteration.
   *
   * Not reported, and not decoration: it is what makes "this row measured a
   * *different* world from that row" checkable. A benchmark that took the
   * parameter and then generated the same world three times would produce three
   * plausible, slightly different timings and no other symptom at all.
   */
  readonly checksum: number;
}

/**
 * Time the shipped tile at a given crater density.
 *
 * **This replaces Phase 0's standalone crater cost model, and it is a different
 * kind of measurement.** That model was a second implementation of a similar
 * workload, written when the kernel had no crater pass at all; since WP10 the
 * real two-tier pass runs inside `generate`, so the thing to measure is not an
 * analogue of it but the difference it makes to the tile that ships.
 *
 * Everything except `spec.craters.densityScale` is held fixed, so the gap
 * between the top and bottom rows is the crater population and nothing else —
 * not the lattice walk, not the basin field, not the regolith pass, all of which
 * run identically at every density. That is what makes the number usable as a
 * mitigation estimate: it is the part of the tile a saturation cap could move.
 */
export function benchDensity(n: number, densityScale: number, iterations: number): DensityBenchRow {
  const tiles = benchTiles();
  const cache = new Map<number, TileGenOutput>();
  const out = scratchFor(n, cache);
  const world = worldAtDensity(densityScale);
  const gen = new TsTileGenerator('bench');
  let checksum = 0;

  const timing = time(
    `density ${densityScale.toFixed(2)} n=${n}`,
    () => {
      let acc = 0;
      for (const id of tiles) {
        const tile = gen.generate(id, world, n, out);
        acc += tile.elevation[0]!;
      }
      checksum = acc;
      return acc;
    },
    { iterations, opsPerIteration: tiles.length },
  );

  return { n, densityScale, timing, checksum };
}

export interface DepthBenchRow {
  readonly n: number;
  readonly depth: number;
  /** Crater bands the gate admits at this depth — the reason the cost varies. */
  readonly bands: number;
  readonly timing: Timing;
  /** As {@link DensityBenchRow.checksum}: proof each row measured a different tile set. */
  readonly checksum: number;
}

/**
 * Time one tile per face at each depth, separately.
 *
 * The headline figure averages depths 0-6 and that average is not what the
 * budget is about. `bandsForDepth` is monotonic in depth, so the deepest tile
 * evaluates the most bands and is the one that has to fit; an average that
 * includes four cheap shallow tiles for every expensive deep one can report a
 * pass on a workload whose worst member misses.
 */
export function benchByDepth(n: number, maxDepth: number, iterations: number): DepthBenchRow[] {
  const cache = new Map<number, TileGenOutput>();
  const out = scratchFor(n, cache);
  const gen = new TsTileGenerator('bench');
  const rows: DepthBenchRow[] = [];

  for (let depth = 0; depth <= maxDepth; depth++) {
    const tiles = tilesAtDepth(depth);
    let checksum = 0;
    const timing = time(
      `depth ${depth} n=${n}`,
      () => {
        let acc = 0;
        for (const id of tiles) {
          const tile = gen.generate(id, BENCH_WORLD, n, out);
          acc += tile.elevation[0]!;
        }
        checksum = acc;
        return acc;
      },
      { iterations, opsPerIteration: tiles.length },
    );
    rows.push({ n, depth, bands: bandsForDepth(depth), timing, checksum });
  }

  return rows;
}

export interface BasinBenchRow {
  readonly timing: Timing;
  /** Basins the field actually holds, at the benchmark world's density. */
  readonly count: number;
}

/**
 * Time the tier-1 global basin pass — the shipped one, `buildBasins`.
 *
 * Phase 0 measured a synthetic stand-in here and reported it as a once-per-world
 * cost. It is not once per world: `generateTile` rebuilds the field on **every
 * tile**, deliberately, so that the tile path and the export path cannot
 * disagree about it. So this row is a per-tile cost that is already inside the
 * single-tile figure, and it is measured separately because it is the one part
 * of the pass that does not scale with the grid.
 */
export function benchBasins(iterations: number): BasinBenchRow {
  const { seedHi, seedLo } = BENCH_WORLD;
  const density = BENCH_WORLD.spec.craters.densityScale;
  // Reused across calls, as the generator reuses its module-level store.
  let store: BasinField | undefined;

  const timing = time(
    'basin field',
    () => {
      store = buildBasins(seedHi, seedLo, density, store);
      return store.count;
    },
    { iterations, opsPerIteration: 1 },
  );

  return { timing, count: store?.count ?? 0 };
}
