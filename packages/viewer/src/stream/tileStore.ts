/**
 * Tile streaming: the worker pool, the request queue and the cache, tied
 * together behind one `request`/`take` interface.
 *
 * The contract with the renderer is deliberately narrow. Each frame it hands
 * over the set of tiles it wants and their priorities; the store decides what
 * to generate, in what order, and what to forget. Nothing about worker
 * lifecycle or cancellation leaks out.
 */
import { type World, tileDepth } from '@traveller-mainworld/core';

import { TileCache } from './cache.js';
import type { TileReadyMessage, WorkerRequest, WorkerResponse } from './protocol.js';
import { PriorityQueue } from './queue.js';

/** A tile ready to render. */
export interface ReadyTile {
  readonly tileId: number;
  readonly n: number;
  readonly positions: Float32Array;
  readonly colours: Float32Array;
  readonly minElevation: number;
  readonly maxElevation: number;
}

export interface TileStoreOptions {
  readonly world: World;
  readonly genVersion: string;
  readonly n: number;
  readonly radius: number;
  readonly elevationScale: number;
  /** Skirt depth for a tile at a given quadtree depth. */
  readonly skirtDepthFor: (depth: number) => number;
  /** Worker count. Defaults to `hardwareConcurrency - 1`, clamped to [1, 8]. */
  readonly workerCount?: number;
  /** Cache capacity in tiles. */
  readonly cacheCapacity?: number;
  /** Factory for workers; injectable so tests can supply a fake. */
  readonly createWorker?: () => Worker;
}

export interface StoreStats {
  readonly queued: number;
  readonly inFlight: number;
  readonly workers: number;
  readonly cache: ReturnType<TileCache<ReadyTile>['stats']>;
  readonly cancelled: number;
  readonly generated: number;
  /** Mean worker-side generation time, ms. */
  readonly meanGenerateMs: number;
  /** Bytes transferred from workers, cumulative. */
  readonly bytesTransferred: number;
}

/**
 * Default worker count.
 *
 * One less than `hardwareConcurrency` leaves a core for the main thread, which
 * is doing the render; capped at 8 because tile generation is memory-bandwidth
 * bound past that and extra workers mostly add contention. Confirm against the
 * Spike B scaling numbers before changing.
 */
function defaultWorkerCount(): number {
  const hc = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency ?? 4);
  return Math.max(1, Math.min(8, hc - 1));
}

export class TileStore {
  private readonly cache: TileCache<ReadyTile>;
  private readonly queue = new PriorityQueue();
  private readonly workers: Worker[] = [];
  /** Workers not currently generating, as indices into {@link workers}. */
  private readonly idle: number[] = [];
  /** tileId currently being generated, per worker index. */
  private readonly busyWith = new Map<number, number>();
  /** Tiles that finished since the last {@link take}. */
  private ready: ReadyTile[] = [];

  private nextRequestId = 1;
  private cancelled = 0;
  private generated = 0;
  private totalGenerateMs = 0;
  private bytesTransferred = 0;
  private disposed = false;

  constructor(private readonly options: TileStoreOptions) {
    this.cache = new TileCache<ReadyTile>(options.cacheCapacity ?? 512);

    const count = options.workerCount ?? defaultWorkerCount();
    const create =
      options.createWorker ??
      ((): Worker =>
        new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' }));

    for (let i = 0; i < count; i++) {
      const worker = create();
      worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
        this.onWorkerMessage(i, event.data);
      };
      const init: WorkerRequest = {
        type: 'init',
        world: options.world,
        genVersion: options.genVersion,
      };
      worker.postMessage(init);
      this.workers.push(worker);
      this.idle.push(i);
    }
  }

  /** Cached tile, if present. Does not enqueue. */
  get(tileId: number): ReadyTile | undefined {
    return this.cache.get(tileId, this.options.genVersion);
  }

  has(tileId: number): boolean {
    return this.cache.has(tileId, this.options.genVersion);
  }

  /**
   * Declare the tiles wanted this frame, with priorities.
   *
   * Anything queued but no longer wanted is dropped here — the cancellation
   * path. Work already in flight is *not* interrupted: the result is a valid
   * immutable tile regardless of whether the camera still wants it, so it gets
   * cached rather than wasted.
   *
   * @param wanted   Tile IDs to have available, best first.
   * @param priority Lower is more urgent. Screen-space error, inverted.
   */
  request(wanted: Iterable<number>, priority: (tileId: number) => number): void {
    if (this.disposed) {
      return;
    }
    const keep = new Set<number>();
    for (const tileId of wanted) {
      keep.add(tileId);
      if (this.cache.has(tileId, this.options.genVersion)) {
        continue;
      }
      if (this.isInFlight(tileId)) {
        continue;
      }
      this.queue.push(tileId, priority(tileId));
    }

    this.cancelled += this.queue.retainOnly(keep);
    // Keep the visible set at the recent end of the LRU, so streaming a new
    // region cannot evict the region currently on screen.
    this.cache.touchAll(keep, this.options.genVersion);
    this.pump();
  }

  /** Tiles that became ready since the last call. Drains the buffer. */
  take(): ReadyTile[] {
    const out = this.ready;
    this.ready = [];
    return out;
  }

  stats(): StoreStats {
    return {
      queued: this.queue.size,
      inFlight: this.busyWith.size,
      workers: this.workers.length,
      cache: this.cache.stats(),
      cancelled: this.cancelled,
      generated: this.generated,
      meanGenerateMs: this.generated === 0 ? 0 : this.totalGenerateMs / this.generated,
      bytesTransferred: this.bytesTransferred,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
    this.idle.length = 0;
    this.busyWith.clear();
    this.queue.clear();
    this.cache.clear();
  }

  private isInFlight(tileId: number): boolean {
    for (const active of this.busyWith.values()) {
      if (active === tileId) {
        return true;
      }
    }
    return false;
  }

  /** Hand queued work to idle workers. */
  private pump(): void {
    while (this.idle.length > 0 && this.queue.size > 0) {
      const tileId = this.queue.pop()!;
      if (this.cache.has(tileId, this.options.genVersion) || this.isInFlight(tileId)) {
        continue;
      }
      const workerIndex = this.idle.pop()!;
      this.busyWith.set(workerIndex, tileId);

      const message: WorkerRequest = {
        type: 'generate',
        tileId,
        n: this.options.n,
        radius: this.options.radius,
        elevationScale: this.options.elevationScale,
        skirtDepth: this.options.skirtDepthFor(tileDepth(tileId)),
        requestId: this.nextRequestId++,
      };
      this.workers[workerIndex]!.postMessage(message);
    }
  }

  private onWorkerMessage(workerIndex: number, response: WorkerResponse): void {
    this.busyWith.delete(workerIndex);
    if (!this.disposed) {
      this.idle.push(workerIndex);
    }

    if (response.type === 'error') {
      // A failed tile is not retried: the failure is deterministic (the same
      // inputs will fail the same way), so retrying would spin. Surfaced for
      // diagnostics instead.
      console.error(`tile ${response.tileId} failed to generate: ${response.message}`);
      this.pump();
      return;
    }

    this.acceptTile(response);
    this.pump();
  }

  private acceptTile(msg: TileReadyMessage): void {
    const tile: ReadyTile = {
      tileId: msg.tileId,
      n: msg.n,
      positions: msg.positions,
      colours: msg.colours,
      minElevation: msg.minElevation,
      maxElevation: msg.maxElevation,
    };

    this.generated++;
    this.totalGenerateMs += msg.generateMs;
    this.bytesTransferred += msg.positions.byteLength + msg.colours.byteLength;

    this.cache.set(msg.tileId, this.options.genVersion, tile);
    this.ready.push(tile);
  }
}
