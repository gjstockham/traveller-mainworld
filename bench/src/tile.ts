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
  type TileGenOutput,
  type TileGenerator,
  TsTileGenerator,
  tileBounds,
  tileFace,
} from '@traveller-mainworld/core';

import { compositeCraters, type CraterStats, globalCraterPass } from './craters.js';
import { type Timing, time } from './harness.js';
import { BENCH_WORLD, benchTiles, scratchFor, vertexCount } from './workloads.js';

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

export interface CraterBenchRow {
  readonly n: number;
  readonly timing: Timing;
  readonly stats: CraterStats;
}

/**
 * Time the crater pass on top of an already-generated tile.
 *
 * Measured as an increment, not folded into the tile figure, because it is a
 * cost model for Phase-1 work rather than a measurement of anything that
 * currently ships — see `craters.ts`. Reporting it separately keeps the two
 * kinds of number distinguishable in the results table.
 */
export function benchCraters(n: number, iterations: number): CraterBenchRow {
  const tiles = benchTiles();
  const cache = new Map<number, TileGenOutput>();
  const out = scratchFor(n, cache);

  // Generate once, outside the timed region: the crater pass is being measured,
  // not the fBm underneath it.
  const gen = new TsTileGenerator('bench');
  const bounds = tiles.map((id) => ({ id, b: tileBounds(id), face: tileFace(id) }));
  gen.generate(tiles[0]!, BENCH_WORLD, n, out);

  let stats: CraterStats = { cellsVisited: 0, cratersPlaced: 0, vertexUpdates: 0 };

  const timing = time(
    `craters n=${n}`,
    () => {
      let acc = 0;
      let cells = 0;
      let placed = 0;
      let updates = 0;
      for (const { b, face } of bounds) {
        const s = compositeCraters(
          out,
          face,
          b.u0,
          b.v0,
          b.size,
          n,
          BENCH_WORLD.spec.terrainAmplitudeM,
        );
        cells += s.cellsVisited;
        placed += s.cratersPlaced;
        updates += s.vertexUpdates;
        acc += out.elevation[0]!;
      }
      stats = { cellsVisited: cells, cratersPlaced: placed, vertexUpdates: updates };
      return acc;
    },
    { iterations, opsPerIteration: tiles.length },
  );

  return { n, timing, stats };
}

/** Time the global large-crater placement pass over a 512²-per-face base grid. */
export function benchGlobalPass(resolution: number, iterations: number): Timing {
  return time(`global pass ${resolution}²/face`, () => globalCraterPass(resolution), {
    iterations,
    opsPerIteration: 1,
  });
}
