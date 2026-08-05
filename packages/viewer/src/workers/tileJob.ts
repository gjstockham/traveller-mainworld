/**
 * The work one tile request does, with the kernel as a parameter.
 *
 * Split out of `tileWorker.ts` so the generator arrives as an argument rather
 * than being constructed at the point of use. That is what makes ADR-0001's
 * "revisable at the seam" claim checkable rather than merely asserted: this
 * function names `TileGenerator` and nothing else, so `test/tileJob.test.ts`
 * can run the real WASM twin through the identical path and compare the
 * renderer-ready buffers. A seam nothing exercises is a comment.
 */
import { type TileGenOutput, type TileGenerator, type World, worldPalette } from '@traveller-mainworld/core';

import { buildTileColours, buildTilePositions, vertexCount } from '../mesh/tileMesh.js';
import { allocateNormalScratch, buildTileNormals } from '../mesh/tileNormals.js';
import type { GenerateMessage, TileReadyMessage } from '../stream/protocol.js';

export interface TileJobResult {
  readonly response: TileReadyMessage;
  /** Buffers to hand to `postMessage`'s transfer list; detached on send. */
  readonly transfer: readonly ArrayBuffer[];
}

/**
 * Generate a tile and build its renderable buffers.
 *
 * Both happen here rather than on the main thread: the mesh build costs about
 * the same as a memcpy of the raw output, and doing it in the worker means only
 * the renderer-ready Float32 arrays cross the boundary — roughly half the bytes
 * of the raw Float64 elevation plus directions, and no main-thread work at all
 * on arrival.
 *
 * @param scratch Caller-owned buffers for the raw kernel output, pooled by the
 *                worker across requests. Must match `msg.n`.
 * @param normalScratch Caller-owned apron-position scratch, likewise pooled.
 *                Optional so the tests that exercise the kernel seam do not
 *                each have to carry one; production always passes it.
 */
export function runTileJob(
  generator: TileGenerator,
  world: World,
  msg: GenerateMessage,
  scratch: TileGenOutput,
  normalScratch: Float64Array = allocateNormalScratch(msg.n),
): TileJobResult {
  const started = performance.now();
  const tile = generator.generate(msg.tileId, world, msg.n, scratch);

  const verts = vertexCount(msg.n);
  const positions = new Float32Array(verts * 3);
  const colours = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);

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
  // Derived per tile rather than passed in. It is a handful of integer mixes
  // from the seed the tile was already generated with, so a cache would buy
  // nothing and would be a second place for the viewer and the exporter to
  // disagree about which world they are colouring.
  buildTileColours(
    tile.albedo,
    tile.materials,
    worldPalette(world.seedHi, world.seedLo),
    msg.n,
    colours,
  );
  // The apron's only consumer. It never leaves the worker: `(n+3)²` doubles is
  // larger than all three Float32 buffers together, and the normals are what
  // the renderer actually wants.
  buildTileNormals(
    msg.tileId,
    tile.apronElevation,
    { n: msg.n, radius: msg.radius, elevationScale: msg.elevationScale },
    normalScratch,
    normals,
  );

  let minElevation = Infinity;
  let maxElevation = -Infinity;
  const gridVerts = (msg.n + 1) * (msg.n + 1);
  for (let i = 0; i < gridVerts; i++) {
    const e = tile.elevation[i]!;
    if (e < minElevation) minElevation = e;
    if (e > maxElevation) maxElevation = e;
  }

  return {
    response: {
      type: 'tile',
      tileId: msg.tileId,
      requestId: msg.requestId,
      n: msg.n,
      positions,
      colours,
      normals,
      minElevation,
      maxElevation,
      generateMs: performance.now() - started,
    },
    transfer: [positions.buffer, colours.buffer, normals.buffer],
  };
}
