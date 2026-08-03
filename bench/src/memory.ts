/**
 * Per-tile footprint and steady-state memory under an LRU.
 *
 * The footprint half is arithmetic, not measurement: buffer sizes are exactly
 * determined by `n`, and a measured figure would only add allocator noise to a
 * number that is already known precisely. The steady-state half has to be
 * measured, because it is dominated by what V8 does rather than by what the
 * code asks for.
 *
 * The whole point is to size the viewer's `TileCache` capacity, which is
 * currently a guess. A cache too small re-generates tiles the camera is still
 * looking at; too large and a ten-minute session grows without bound, which is
 * one of Spike C's exit criteria.
 */
import { renderBytes, tileBytes, vertexCount } from './workloads.js';

export interface FootprintRow {
  readonly n: number;
  readonly vertices: number;
  /** Raw kernel output, which never leaves the worker. */
  readonly rawBytes: number;
  /** Renderer-ready Float32 positions and colours, which is what the cache holds. */
  readonly renderBytes: number;
  /** Tiles that fit in 256 MiB of renderer-ready data. */
  readonly tilesPer256MiB: number;
}

/** Exact footprint of one tile at each grid resolution. */
export function footprint(n: number): FootprintRow {
  const render = renderBytes(n);
  return {
    n,
    vertices: vertexCount(n),
    rawBytes: tileBytes(n).total,
    renderBytes: render,
    tilesPer256MiB: Math.floor((256 * 1024 * 1024) / render),
  };
}

export interface SteadyStateRow {
  readonly n: number;
  readonly capacity: number;
  /**
   * Growth in `arrayBuffers` after filling the cache and churning through it.
   *
   * **Not `heapUsed`.** V8 allocates typed-array backing stores outside the JS
   * heap, so `heapUsed` sees a few hundred bytes of wrapper object per tile and
   * misses the four hundred kilobytes of actual data. Measuring the wrong
   * counter here reports a cache that costs nothing, which is precisely the
   * conclusion that would let a ten-minute session run out of memory.
   */
  readonly arrayBufferGrowthBytes: number;
  /** Resident-set growth, which also catches anything the allocator did not return. */
  readonly rssGrowthBytes: number;
  /** `arrayBuffers` growth per resident tile. */
  readonly bytesPerTile: number;
  /** Predicted from `renderBytes` alone — the gap is allocator and object overhead. */
  readonly predictedBytesPerTile: number;
}

/**
 * Fill an LRU to capacity, then churn twice its capacity through it, and see
 * how much heap is left behind.
 *
 * The churn is the point. Filling a cache once measures nothing interesting;
 * cycling through it is where a retained reference — an eviction callback that
 * keeps the buffer alive, say — shows up as growth that does not level off.
 *
 * Run this with `--expose-gc` for a stable figure. Without it the result still
 * shows the *shape* (level or climbing) but the absolute number includes
 * whatever V8 has not got around to collecting.
 */
export function benchSteadyState(n: number, capacity: number): SteadyStateRow {
  const gc = (globalThis as { gc?: () => void }).gc;
  const verts = vertexCount(n) + 8 * (n + 1);

  const makeTile = (): { positions: Float32Array; colours: Float32Array } => ({
    positions: new Float32Array(verts * 3),
    colours: new Float32Array(verts * 3),
  });

  const cache = new Map<number, { positions: Float32Array; colours: Float32Array }>();
  const insert = (key: number): void => {
    cache.set(key, makeTile());
    while (cache.size > capacity) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  };

  /**
   * Collect repeatedly, not once.
   *
   * A typed array's backing store lives outside the JS heap and is only
   * released on the GC *after* the wrapper object is collected, so a single
   * `gc()` leaves the previous measurement's cache still counted. That
   * contaminates the next baseline, and the symptom is a later measurement
   * reporting less memory per tile than the buffers provably occupy — or, as
   * happened here first time round, negative RSS growth.
   */
  const collect = (): void => {
    for (let i = 0; i < 3; i++) gc?.();
  };

  collect();
  const before = process.memoryUsage();

  for (let i = 0; i < capacity; i++) insert(i);
  // Churn twice the capacity through it. Filling a cache once measures nothing
  // interesting; cycling is where a retained reference — an eviction callback
  // holding on to a buffer, say — shows up as growth that never levels off.
  for (let i = 0; i < capacity * 2; i++) insert(capacity + i);

  collect();
  const after = process.memoryUsage();

  // Keep the cache alive across the measurement; without this the whole thing
  // is collectable before `after` is read and the answer is always zero.
  if (cache.size !== capacity) {
    throw new Error(`cache held ${cache.size} tiles, expected ${capacity}`);
  }

  const growth = after.arrayBuffers - before.arrayBuffers;
  const row: SteadyStateRow = {
    n,
    capacity,
    arrayBufferGrowthBytes: growth,
    rssGrowthBytes: after.rss - before.rss,
    bytesPerTile: growth / capacity,
    predictedBytesPerTile: renderBytes(n),
  };

  // Hand the next measurement a clean process. Leaving this cache resident
  // would inflate its baseline and understate its growth.
  cache.clear();
  collect();

  return row;
}

/** True if the process was started with `--expose-gc`, which the figures above want. */
export function haveGc(): boolean {
  return typeof (globalThis as { gc?: () => void }).gc === 'function';
}
