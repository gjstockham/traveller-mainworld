/**
 * Tile generation worker.
 *
 * Generates the tile *and* builds its renderable buffers here rather than on
 * the main thread: the mesh build is the same order of cost as a memcpy of the
 * raw output, and doing it here means only the renderer-ready Float32 arrays
 * cross the boundary — roughly half the bytes of the raw Float64 elevation plus
 * directions, and no main-thread work at all on arrival.
 */
import {
  type TileGenOutput,
  TsTileGenerator,
  type World,
  allocateTileOutput,
} from '@traveller-mainworld/core';

import { buildTileColours, buildTilePositions, vertexCount } from '../mesh/tileMesh.js';
import type { GenerateMessage, WorkerRequest, WorkerResponse } from '../stream/protocol.js';

let world: World | undefined;
let generator: TsTileGenerator | undefined;

/**
 * Reusable buffers, keyed by grid resolution.
 *
 * A worker generates one tile at a time, so a single scratch set per `n` is
 * enough — and it keeps the allocator out of the hot path entirely. The output
 * Float32 arrays cannot be pooled this way because they are transferred away.
 */
const scratch = new Map<number, TileGenOutput>();

function scratchFor(n: number): TileGenOutput {
  let s = scratch.get(n);
  if (s === undefined) {
    s = allocateTileOutput(n);
    scratch.set(n, s);
  }
  return s;
}

function handleGenerate(msg: GenerateMessage): void {
  if (world === undefined || generator === undefined) {
    throw new Error('worker received a generate request before init');
  }

  const started = performance.now();
  const tile = generator.generate(msg.tileId, world, msg.n, scratchFor(msg.n));

  const verts = vertexCount(msg.n);
  const positions = new Float32Array(verts * 3);
  const colours = new Float32Array(verts * 3);

  buildTilePositions(
    tile.directions,
    tile.elevation,
    {
      n: msg.n,
      radius: msg.radius,
      elevationScale: msg.elevationScale,
      skirtDepth: msg.skirtDepth,
    },
    positions,
  );
  buildTileColours(
    tile.elevation,
    tile.materials,
    world.spec.terrainAmplitudeM,
    msg.n,
    colours,
  );

  let minElevation = Infinity;
  let maxElevation = -Infinity;
  const gridVerts = (msg.n + 1) * (msg.n + 1);
  for (let i = 0; i < gridVerts; i++) {
    const e = tile.elevation[i]!;
    if (e < minElevation) minElevation = e;
    if (e > maxElevation) maxElevation = e;
  }

  const response: WorkerResponse = {
    type: 'tile',
    tileId: msg.tileId,
    requestId: msg.requestId,
    n: msg.n,
    positions,
    colours,
    minElevation,
    maxElevation,
    generateMs: performance.now() - started,
  };

  // Transfer, not copy. The arrays are detached here and owned by the main
  // thread on arrival.
  postMessage(response, { transfer: [positions.buffer, colours.buffer] });
}

onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        world = msg.world;
        generator = new TsTileGenerator(msg.genVersion);
        scratch.clear();
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
