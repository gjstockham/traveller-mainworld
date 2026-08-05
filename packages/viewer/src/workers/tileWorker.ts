/**
 * Tile generation worker.
 *
 * Deliberately thin: it owns the message plumbing and the scratch pool, and
 * nothing else. Which kernel it runs comes from `kernel/choice.ts` (ADR-0001)
 * and the work itself from `tileJob.ts` — so this file names no kernel
 * implementation and does not change when the ADR's revisit trigger fires.
 */
import {
  type TileGenOutput,
  type TileGenerator,
  type World,
  allocateTileOutput,
} from '@traveller-mainworld/core';

import { createTileGenerator } from '../kernel/choice.js';
import { allocateNormalScratch } from '../mesh/tileNormals.js';
import type { GenerateMessage, WorkerRequest, WorkerResponse } from '../stream/protocol.js';

import { runTileJob } from './tileJob.js';

let world: World | undefined;
let generator: TileGenerator | undefined;

/**
 * Reusable buffers, keyed by grid resolution.
 *
 * A worker generates one tile at a time, so a single scratch set per `n` is
 * enough — and it keeps the allocator out of the hot path entirely. The output
 * Float32 arrays cannot be pooled this way because they are transferred away.
 */
const scratch = new Map<number, TileGenOutput>();
/** Apron-position scratch for the normals, pooled for the same reason. */
const normalScratch = new Map<number, Float64Array>();

function scratchFor(n: number): TileGenOutput {
  let s = scratch.get(n);
  if (s === undefined) {
    s = allocateTileOutput(n);
    scratch.set(n, s);
  }
  return s;
}

function normalScratchFor(n: number): Float64Array {
  let s = normalScratch.get(n);
  if (s === undefined) {
    s = allocateNormalScratch(n);
    normalScratch.set(n, s);
  }
  return s;
}

function handleGenerate(msg: GenerateMessage): void {
  if (world === undefined || generator === undefined) {
    throw new Error('worker received a generate request before init');
  }

  const { response, transfer } = runTileJob(
    generator,
    world,
    msg,
    scratchFor(msg.n),
    normalScratchFor(msg.n),
  );

  // Transfer, not copy. The arrays are detached here and owned by the main
  // thread on arrival.
  postMessage(response, { transfer: [...transfer] });
}

onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        world = msg.world;
        generator = createTileGenerator(msg.genVersion);
        scratch.clear();
        normalScratch.clear();
        break;
      case 'generate':
        handleGenerate(msg);
        break;
    }
  } catch (error) {
    const failure: WorkerResponse = {
      type: 'error',
      tileId: msg.type === 'generate' ? msg.tileId : -1,
      requestId: msg.type === 'generate' ? msg.requestId : -1,
      message: error instanceof Error ? error.message : String(error),
    };
    postMessage(failure);
  }
};
