/**
 * Main-thread ↔ worker message protocol.
 *
 * Every payload buffer crosses as a transferable, never a structured-clone
 * copy: a 129² tile is ~400 KB of Float64, and copying that per tile at
 * 20-30 tiles/s would cost more than generating it. `TileStore` asserts the
 * transfer actually happened rather than assuming it.
 */
import type { World } from '@traveller-mainworld/core';

/** Sent once when a worker starts, to fix the world it generates for. */
export interface InitMessage {
  readonly type: 'init';
  readonly world: World;
  readonly genVersion: string;
}

/** A request for one tile. */
export interface GenerateMessage {
  readonly type: 'generate';
  readonly tileId: number;
  /** Grid resolution; the vertex grid is `(n+1)²`. */
  readonly n: number;
  /** Scene units for the planet radius. */
  readonly radius: number;
  /** Scene units per metre of elevation. */
  readonly elevationScale: number;
  /** How far skirt vertices are pushed inward, in scene units. */
  readonly skirtDepth: number;
  /** Echoed back, so a late reply can be matched to its request. */
  readonly requestId: number;
}

export type WorkerRequest = InitMessage | GenerateMessage;

/** A completed tile. Buffers are renderer-ready; the main thread does no maths. */
export interface TileReadyMessage {
  readonly type: 'tile';
  readonly tileId: number;
  readonly requestId: number;
  readonly n: number;
  /** `3 * vertexCount(n)` floats. */
  readonly positions: Float32Array;
  /** `3 * vertexCount(n)` floats. */
  readonly colours: Float32Array;
  /** Minimum and maximum elevation in metres, for diagnostics and camera limits. */
  readonly minElevation: number;
  readonly maxElevation: number;
  /** Milliseconds spent generating, for the Spike B numbers. */
  readonly generateMs: number;
}

export interface WorkerErrorMessage {
  readonly type: 'error';
  readonly tileId: number;
  readonly requestId: number;
  readonly message: string;
}

export type WorkerResponse = TileReadyMessage | WorkerErrorMessage;
