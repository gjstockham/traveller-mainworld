/**
 * Worker-pool throughput and buffer transfer cost.
 *
 * Two questions from spike plan §B.2:
 *
 * 1. Does throughput scale roughly linearly with worker count, up to
 *    `hardwareConcurrency − 1`? Sub-linear scaling would mean the pipeline is
 *    bound by something other than generation, and the fix would be there
 *    rather than in the kernel.
 * 2. Do tile buffers actually cross as transferables rather than structured
 *    clones? The plan says "measure to prove it", and that is the right
 *    instinct: a missing transfer list is silent, costs a full memcpy per tile,
 *    and looks exactly like a slow kernel.
 *
 * **These are `node:worker_threads`, not browser `Worker`s.** The scaling shape
 * carries over — both are OS threads running the same V8 — but the absolute
 * numbers are the reference platform's, and the browser legs belong to the
 * viewer's own diagnostics overlay.
 */
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { GEN_VERSION } from '@traveller-mainworld/core';

import { type Timing, timeAsync } from './harness.js';
import { BENCH_WORLD, benchTiles, renderBytes } from './workloads.js';

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'poolWorker.js');

export interface PoolRow {
  readonly workers: number;
  readonly n: number;
  readonly timing: Timing;
  /** Tiles per second, from the median. */
  readonly tilesPerSecond: number;
  /** Throughput relative to one worker — 1.0 would be perfect scaling. */
  readonly scalingEfficiency: number;
}

/** Distribute `tiles` across `workers`, resolving when all have come back. */
async function runPool(
  workers: readonly Worker[],
  tiles: readonly number[],
  n: number,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const listeners = new Map<Worker, (msg: { elevation: Float64Array }) => void>();
    let next = 0;
    let completed = 0;
    let acc = 0;

    const detach = (): void => {
      for (const [w, fn] of listeners) w.off('message', fn);
    };

    const pump = (w: Worker): void => {
      if (next < tiles.length) {
        w.postMessage({ tileId: tiles[next++], n });
      }
    };

    for (const w of workers) {
      const onMessage = (msg: { elevation: Float64Array }): void => {
        acc += msg.elevation[0]!;
        completed++;
        if (completed === tiles.length) {
          detach();
          resolve(acc);
          return;
        }
        pump(w);
      };
      listeners.set(w, onMessage);
      w.on('message', onMessage);
      w.once('error', (err) => {
        detach();
        reject(err);
      });
    }

    // Two requests in flight per worker before any result comes back, so the
    // pool is saturated from the first millisecond and a worker is never idle
    // waiting for the main thread to notice it finished.
    for (const w of workers) {
      pump(w);
      pump(w);
    }
  });
}

/**
 * Measure throughput at each worker count from 1 to `maxWorkers`.
 *
 * Workers are created once per count and reused across iterations: thread
 * startup plus the first-tile JIT warm-up is tens of milliseconds, which would
 * swamp a measurement of a workload that takes a few hundred.
 */
export async function benchPool(
  n: number,
  maxWorkers: number,
  tileCount: number,
  iterations: number,
): Promise<PoolRow[]> {
  const tiles: number[] = [];
  const base = benchTiles(tileCount);
  for (let i = 0; i < tileCount; i++) tiles.push(base[i % base.length]!);

  const rows: PoolRow[] = [];
  let singleWorkerRate = 0;

  for (let count = 1; count <= maxWorkers; count++) {
    const workers: Worker[] = [];
    for (let i = 0; i < count; i++) {
      workers.push(
        new Worker(WORKER_PATH, {
          workerData: { world: BENCH_WORLD, genVersion: GEN_VERSION },
        }),
      );
    }

    try {
      const timing = await timeAsync(`pool x${count} n=${n}`, () => runPool(workers, tiles, n), {
        warmup: 1,
        iterations,
        opsPerIteration: tiles.length,
      });
      const tilesPerSecond = timing.opsPerSecond;
      if (count === 1) singleWorkerRate = tilesPerSecond;
      rows.push({
        workers: count,
        n,
        timing,
        tilesPerSecond,
        scalingEfficiency: tilesPerSecond / (singleWorkerRate * count),
      });
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  }

  return rows;
}

export interface TransferRow {
  readonly n: number;
  readonly bytes: number;
  /**
   * Cost of allocating and touching the buffer, with no `postMessage` at all.
   *
   * The control. Without it the two figures below are dominated by allocation
   * — the first version of this benchmark reported a 129² transfer as *ten
   * times faster* than a 65² one, which is not a fact about `postMessage`.
   */
  readonly allocMs: number;
  /** Allocate, touch, `postMessage` with a transfer list. */
  readonly transferMs: number;
  /** Allocate, touch, `postMessage` without one. */
  readonly cloneMs: number;
  /** `postMessage` cost alone, allocation subtracted. */
  readonly transferOnlyMs: number;
  readonly cloneOnlyMs: number;
  /** True if the sender's buffer was actually detached — the proof, not the assumption. */
  readonly detached: boolean;
}

/**
 * Compare transferring a tile's buffers against structured-cloning them, and
 * prove the transfer happened.
 *
 * The proof matters more than the timing. `postMessage(msg, [buf])` silently
 * degrades to a copy if the buffer is not reachable from `msg`, or if the
 * transfer list is simply forgotten — and the symptom is a pipeline that is
 * mysteriously slower than the sum of its parts. Asserting `byteLength === 0`
 * afterwards is the only way to know.
 */
export async function benchTransfer(n: number, rounds: number): Promise<TransferRow> {
  // The renderer-ready payload, not the raw elevation: positions and colours
  // are what actually cross the boundary, and they are three times the bytes.
  // Measuring the cheaper buffer would understate the cost being budgeted for.
  const payload = renderBytes(n);
  const size = payload / 8;

  const worker = new Worker(WORKER_PATH, {
    workerData: { world: BENCH_WORLD, genVersion: GEN_VERSION },
  });

  try {
    // Detachment check first, on a single buffer, before any timing.
    const probe = new Float64Array(size);
    worker.postMessage({ probe }, [probe.buffer]);
    const detached = probe.byteLength === 0;

    /** `mode` 'none' is the control: allocate and touch, but do not send. */
    const timeSends = (mode: 'none' | 'transfer' | 'clone'): number => {
      const started = performance.now();
      for (let i = 0; i < rounds; i++) {
        const buf = new Float64Array(size);
        // Touch both ends, so the pages are resident and a copy is a real copy.
        buf[0] = i;
        buf[size - 1] = i;
        if (mode === 'transfer') {
          worker.postMessage({ payload: buf }, [buf.buffer]);
        } else if (mode === 'clone') {
          worker.postMessage({ payload: buf });
        } else {
          // Keep the allocation observable so it is not optimised away.
          if (buf[0] !== i) throw new Error('unreachable');
        }
      }
      return performance.now() - started;
    };

    // Warm every path before measuring any, and measure in an order that does
    // not advantage whichever ran first.
    for (const mode of ['none', 'transfer', 'clone'] as const) {
      timeSends(mode);
      timeSends(mode);
    }

    const allocMs = timeSends('none') / rounds;
    const transferMs = timeSends('transfer') / rounds;
    const cloneMs = timeSends('clone') / rounds;

    return {
      n,
      bytes: payload,
      allocMs,
      transferMs,
      cloneMs,
      transferOnlyMs: Math.max(0, transferMs - allocMs),
      cloneOnlyMs: Math.max(0, cloneMs - allocMs),
      detached,
    };
  } finally {
    await worker.terminate();
  }
}

/** Workers the pipeline would actually use: `hardwareConcurrency − 1`, at least 1, capped at 8. */
export function defaultPoolSize(): number {
  return Math.max(1, Math.min(8, availableParallelism() - 1));
}
