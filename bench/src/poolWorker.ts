/**
 * Worker body for the pool throughput benchmark.
 *
 * Mirrors `viewer/src/workers/tileWorker.ts` in shape — pooled scratch for the
 * kernel output, a freshly allocated buffer for the result, transferred rather
 * than copied — but posts the raw elevation instead of building the renderable
 * mesh. The mesh build is viewer code that cannot be imported here (the viewer
 * package emits a bundle, not modules), and inventing a lookalike would measure
 * a function nobody ships. What is measured is generation plus the allocate-fill-
 * transfer that any output path has to pay.
 */
import { parentPort, workerData } from 'node:worker_threads';

import {
  type TileGenOutput,
  TsTileGenerator,
  type World,
  allocateTileOutput,
} from '@traveller-mainworld/core';

interface PoolWorkerData {
  readonly world: World;
  readonly genVersion: string;
}

const { world, genVersion } = workerData as PoolWorkerData;
const generator = new TsTileGenerator(genVersion);
const scratch = new Map<number, TileGenOutput>();

function scratchFor(n: number): TileGenOutput {
  let s = scratch.get(n);
  if (s === undefined) {
    s = allocateTileOutput(n);
    scratch.set(n, s);
  }
  return s;
}

type PoolRequest = { tileId: number; n: number } | Record<string, unknown>;

parentPort?.on('message', (msg: PoolRequest) => {
  // The transfer benchmark uses this worker purely as a receiving end, posting
  // payloads that are not generation requests. Ignoring them here keeps that
  // benchmark from needing a second worker whose startup cost would have to be
  // accounted for separately.
  if (typeof msg.tileId !== 'number' || typeof msg.n !== 'number') {
    return;
  }

  const started = performance.now();
  const tile = generator.generate(msg.tileId, world, msg.n, scratchFor(msg.n));

  // A fresh buffer per result, because the scratch is reused for the next tile
  // and a transferred buffer is detached from this side. This copy is the
  // honest cost of handing a result across a thread boundary.
  const elevation = new Float64Array(tile.elevation.length);
  elevation.set(tile.elevation);

  parentPort?.postMessage(
    { tileId: msg.tileId, elevation, generateMs: performance.now() - started },
    [elevation.buffer],
  );
});
