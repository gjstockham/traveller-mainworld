import { DEFAULT_FBM, type World, makeTileId } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { TileCache } from '../src/stream/cache.js';
import type { WorkerRequest, WorkerResponse } from '../src/stream/protocol.js';
import { PriorityQueue } from '../src/stream/queue.js';
import { TileStore } from '../src/stream/tileStore.js';

describe('PriorityQueue', () => {
  it('serves lowest priority value first', () => {
    const q = new PriorityQueue();
    for (const [k, p] of [
      [10, 5],
      [20, 1],
      [30, 9],
      [40, 3],
    ]) {
      q.push(k!, p!);
    }
    expect([q.pop(), q.pop(), q.pop(), q.pop()]).toEqual([20, 40, 10, 30]);
    expect(q.pop()).toBeUndefined();
  });

  it('maintains heap order under random insertion', () => {
    const q = new PriorityQueue();
    const priorities = new Map<number, number>();
    // Deterministic pseudo-random, so a failure reproduces.
    let s = 12345;
    for (let i = 0; i < 2000; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const p = s / 4294967296;
      q.push(i, p);
      priorities.set(i, p);
    }
    let prev = -Infinity;
    let count = 0;
    for (;;) {
      const k = q.pop();
      if (k === undefined) break;
      const p = priorities.get(k)!;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
      count++;
    }
    expect(count).toBe(2000);
  });

  it('updates the priority of an existing key rather than duplicating it', () => {
    const q = new PriorityQueue();
    q.push(1, 10);
    q.push(2, 5);
    expect(q.size).toBe(2);
    q.push(1, 1); // now most urgent
    expect(q.size).toBe(2);
    expect(q.pop()).toBe(1);
    expect(q.pop()).toBe(2);
  });

  it('handles a priority increase as well as a decrease', () => {
    const q = new PriorityQueue();
    q.push(1, 1);
    q.push(2, 2);
    q.push(3, 3);
    q.push(1, 99); // demote
    expect([q.pop(), q.pop(), q.pop()]).toEqual([2, 3, 1]);
  });

  it('removes arbitrary keys while preserving order', () => {
    const q = new PriorityQueue();
    for (let i = 0; i < 50; i++) {
      q.push(i, 50 - i);
    }
    expect(q.remove(25)).toBe(true);
    expect(q.remove(25)).toBe(false);
    expect(q.has(25)).toBe(false);
    expect(q.size).toBe(49);
    let prev = -Infinity;
    for (;;) {
      const k = q.pop();
      if (k === undefined) break;
      expect(50 - k).toBeGreaterThanOrEqual(prev);
      prev = 50 - k;
    }
  });

  it('retainOnly drops exactly the unwanted keys', () => {
    const q = new PriorityQueue();
    for (let i = 0; i < 20; i++) {
      q.push(i, i);
    }
    const keep = new Set([3, 7, 11]);
    expect(q.retainOnly(keep)).toBe(17);
    expect(q.size).toBe(3);
    expect(new Set(q.keys())).toEqual(keep);
  });
});

describe('TileCache', () => {
  const V = '1.0.0';

  it('stores and retrieves by (tileId, genVersion)', () => {
    const c = new TileCache<string>(4);
    c.set(1, V, 'a');
    expect(c.get(1, V)).toBe('a');
    // A different generator version is a different tile, not a stale one.
    expect(c.get(1, '2.0.0')).toBeUndefined();
  });

  it('evicts least-recently-used', () => {
    const evicted: string[] = [];
    const c = new TileCache<string>(3, (v) => evicted.push(v));
    c.set(1, V, 'a');
    c.set(2, V, 'b');
    c.set(3, V, 'c');
    c.get(1, V); // 1 is now most recent; 2 is least
    c.set(4, V, 'd');
    expect(evicted).toEqual(['b']);
    expect(c.has(2, V)).toBe(false);
    expect(c.has(1, V)).toBe(true);
  });

  it('peek does not disturb recency or counters', () => {
    const evicted: string[] = [];
    const c = new TileCache<string>(2, (v) => evicted.push(v));
    c.set(1, V, 'a');
    c.set(2, V, 'b');
    c.peek(1, V);
    c.set(3, V, 'c');
    // peek did not protect 1, so it is still the LRU victim.
    expect(evicted).toEqual(['a']);
    expect(c.stats().hits).toBe(0);
    expect(c.stats().misses).toBe(0);
  });

  it('touchAll protects the visible set from eviction', () => {
    // The thrash case: streaming a new region must not evict what is on screen.
    const evicted: string[] = [];
    const c = new TileCache<string>(4, (v) => evicted.push(v));
    for (let i = 1; i <= 4; i++) {
      c.set(i, V, `v${i}`);
    }
    c.touchAll([1, 2], V); // 1 and 2 are on screen
    c.set(5, V, 'v5');
    c.set(6, V, 'v6');
    expect(evicted).toEqual(['v3', 'v4']);
    expect(c.has(1, V)).toBe(true);
    expect(c.has(2, V)).toBe(true);
  });

  it('tracks hits, misses and evictions', () => {
    const c = new TileCache<string>(2);
    c.set(1, V, 'a');
    c.get(1, V);
    c.get(9, V);
    c.set(2, V, 'b');
    c.set(3, V, 'c');
    const s = c.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.evictions).toBe(1);
    expect(s.size).toBe(2);
  });

  it('rejects a nonsensical capacity', () => {
    expect(() => new TileCache<string>(0)).toThrow(/capacity/);
  });
});

/**
 * A worker stand-in that records what it was sent and replies synchronously on
 * demand, so the store's scheduling can be tested without a browser or real
 * threads.
 */
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  readonly received: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.all.push(this);
  }

  postMessage(msg: WorkerRequest): void {
    this.received.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Pending generate requests not yet replied to. */
  pending(): Extract<WorkerRequest, { type: 'generate' }>[] {
    return this.received.filter(
      (m): m is Extract<WorkerRequest, { type: 'generate' }> => m.type === 'generate',
    );
  }

  /** Reply to the oldest unanswered request. */
  complete(index = 0): void {
    const req = this.pending()[index];
    if (!req) {
      throw new Error('no pending request to complete');
    }
    const verts = (req.n + 1) * (req.n + 1) + 4 * (req.n + 1);
    const response: WorkerResponse = {
      type: 'tile',
      tileId: req.tileId,
      requestId: req.requestId,
      n: req.n,
      positions: new Float32Array(verts * 3),
      colours: new Float32Array(verts * 3),
      minElevation: -100,
      maxElevation: 100,
      generateMs: 5,
    };
    this.received.splice(this.received.indexOf(req), 1);
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}

const WORLD: World = {
  spec: { radiusKm: 1737, terrainAmplitudeM: 6000, fbm: DEFAULT_FBM },
  seedHi: 1,
  seedLo: 2,
};

function makeStore(workerCount = 2, cacheCapacity = 64): TileStore {
  FakeWorker.all = [];
  return new TileStore({
    world: WORLD,
    genVersion: '1.0.0',
    n: 8,
    radius: 1,
    elevationScale: 1e-5,
    skirtDepthFor: () => 0.01,
    workerCount,
    cacheCapacity,
    createWorker: () => new FakeWorker() as unknown as Worker,
  });
}

describe('TileStore', () => {
  const tiles = (count: number): number[] =>
    Array.from({ length: count }, (_, i) => makeTileId(0, 2, i));

  it('initialises every worker before generating', () => {
    makeStore(3);
    expect(FakeWorker.all).toHaveLength(3);
    for (const w of FakeWorker.all) {
      expect(w.received[0]).toMatchObject({ type: 'init', genVersion: '1.0.0' });
    }
  });

  it('never exceeds one in-flight request per worker', () => {
    const store = makeStore(2);
    store.request(tiles(10), (t) => t);
    const inFlight = FakeWorker.all.reduce((sum, w) => sum + w.pending().length, 0);
    expect(inFlight).toBe(2);
    expect(store.stats().inFlight).toBe(2);
    expect(store.stats().queued).toBe(8);
  });

  it('serves highest-priority tiles first', () => {
    const store = makeStore(1);
    const ids = tiles(5);
    // Reverse priority: the last tile is the most urgent.
    store.request(ids, (t) => -t);
    expect(FakeWorker.all[0]!.pending()[0]!.tileId).toBe(Math.max(...ids));
  });

  it('feeds the next queued tile as each worker frees up', () => {
    const store = makeStore(1);
    store.request(tiles(3), (t) => t);
    const w = FakeWorker.all[0]!;
    expect(w.pending()).toHaveLength(1);
    w.complete();
    expect(w.pending()).toHaveLength(1); // next one dispatched
    w.complete();
    w.complete();
    expect(w.pending()).toHaveLength(0);
    expect(store.stats().generated).toBe(3);
  });

  it('CANCELS queued tiles the camera no longer wants', () => {
    const store = makeStore(1);
    const first = tiles(6);
    store.request(first, (t) => t);
    expect(store.stats().queued).toBe(5);

    // Camera moves: an entirely different region is wanted.
    const second = [makeTileId(3, 2, 0), makeTileId(3, 2, 1)];
    store.request(second, (t) => t);

    expect(store.stats().cancelled).toBe(5);
    expect(store.stats().queued).toBe(2);
  });

  it('keeps an in-flight result even after its tile is no longer wanted', () => {
    // Cancellation drops queued work, but work already started produces a
    // valid immutable tile — discarding it would waste the generation.
    const store = makeStore(1);
    const wanted = tiles(3);
    store.request(wanted, (t) => t);
    const inFlightId = FakeWorker.all[0]!.pending()[0]!.tileId;

    store.request([makeTileId(5, 2, 0)], (t) => t);
    FakeWorker.all[0]!.complete();

    expect(store.has(inFlightId)).toBe(true);
    expect(store.take().some((t) => t.tileId === inFlightId)).toBe(true);
  });

  it('does not re-request a cached tile', () => {
    const store = makeStore(1);
    const id = makeTileId(0, 1, 1);
    store.request([id], () => 0);
    FakeWorker.all[0]!.complete();
    store.take();

    store.request([id], () => 0);
    expect(FakeWorker.all[0]!.pending()).toHaveLength(0);
    expect(store.stats().queued).toBe(0);
  });

  it('does not double-request a tile already in flight', () => {
    const store = makeStore(2);
    const id = makeTileId(0, 1, 1);
    store.request([id], () => 0);
    store.request([id], () => 0);
    const total = FakeWorker.all.reduce((s, w) => s + w.pending().length, 0);
    expect(total).toBe(1);
    expect(store.stats().queued).toBe(0);
  });

  it('take() drains, so tiles are delivered exactly once', () => {
    const store = makeStore(1);
    store.request(tiles(2), (t) => t);
    FakeWorker.all[0]!.complete();
    expect(store.take()).toHaveLength(1);
    expect(store.take()).toHaveLength(0);
  });

  it('reports generation timing and transferred bytes', () => {
    const store = makeStore(1);
    store.request(tiles(2), (t) => t);
    FakeWorker.all[0]!.complete();
    FakeWorker.all[0]!.complete();
    const s = store.stats();
    expect(s.generated).toBe(2);
    expect(s.meanGenerateMs).toBeCloseTo(5, 6);
    expect(s.bytesTransferred).toBeGreaterThan(0);
  });

  it('survives a worker error without stalling the pipeline', () => {
    const store = makeStore(1);
    store.request(tiles(2), (t) => t);
    const w = FakeWorker.all[0]!;
    const req = w.pending()[0]!;
    w.received.splice(w.received.indexOf(req), 1);
    w.onmessage?.({
      data: { type: 'error', tileId: req.tileId, requestId: req.requestId, message: 'boom' },
    } as MessageEvent<WorkerResponse>);
    // The worker must be handed the next tile rather than left idle.
    expect(w.pending()).toHaveLength(1);
  });

  it('terminates workers on dispose and ignores later requests', () => {
    const store = makeStore(2);
    store.dispose();
    expect(FakeWorker.all.every((w) => w.terminated)).toBe(true);
    store.request(tiles(4), (t) => t);
    expect(store.stats().queued).toBe(0);
  });
});
