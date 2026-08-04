/**
 * LRU cache for generated tiles.
 *
 * Tiles are immutable value objects keyed by `(tileId, genVersion)`, which is
 * what makes caching safe in the face of out-of-order and cancelled work: a
 * result that arrives late is still exactly the tile that key denotes, so it
 * can be stored rather than discarded. Nothing is ever partially applied.
 *
 * In-memory only for Phase 0. IndexedDB persistence is deliberately deferred:
 * it changes the eviction story and needs the generator version in the key
 * path, and neither is a Phase 0 question.
 */

export interface CacheStats {
  readonly size: number;
  readonly capacity: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  /**
   * Bytes held by cached values, or 0 when no `sizeOf` was supplied.
   *
   * Counted rather than sampled, because the thing it answers — is memory
   * stable over a long session — cannot be read off a tile count. Capacity
   * bounds the count; it does not bound the bytes, since a tile's size depends
   * on the grid resolution it was generated at.
   */
  readonly bytes: number;
}

/**
 * Insertion-ordered `Map` used as an LRU: re-inserting moves a key to the end,
 * and the first key is therefore the least recently used. Avoids maintaining a
 * separate linked list.
 */
export class TileCache<T> {
  private map = new Map<string, T>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private bytes = 0;

  /**
   * @param capacity Maximum tiles retained. Sized from the Spike B memory
   *                 numbers; too small and navigation re-generates constantly,
   *                 too large and a long session grows without bound.
   * @param onEvict  Called with each evicted value, so buffers can be returned
   *                 to a pool rather than left to the GC.
   * @param sizeOf   Retained bytes for a value. Optional: without it the cache
   *                 works exactly as before and reports 0 bytes. Called again
   *                 on removal rather than remembered, which is exact only
   *                 because it is a pure function of an immutable value — which
   *                 tiles are. A `sizeOf` that could return a different answer
   *                 for the same value would drift the running total.
   */
  constructor(
    private readonly capacity: number,
    private readonly onEvict?: (value: T, key: string) => void,
    private readonly sizeOf?: (value: T) => number,
  ) {
    if (capacity < 1) {
      throw new RangeError(`cache capacity must be at least 1, got ${capacity}`);
    }
  }

  /** Cache key. The generator version is part of the identity, not metadata. */
  static keyFor(tileId: number, genVersion: string): string {
    return `${genVersion}:${tileId}`;
  }

  get(tileId: number, genVersion: string): T | undefined {
    const key = TileCache.keyFor(tileId, genVersion);
    const value = this.map.get(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    // Re-insert to move to the most-recent end.
    this.map.delete(key);
    this.map.set(key, value);
    this.hits++;
    return value;
  }

  /** Look up without disturbing recency or the hit/miss counters. */
  peek(tileId: number, genVersion: string): T | undefined {
    return this.map.get(TileCache.keyFor(tileId, genVersion));
  }

  has(tileId: number, genVersion: string): boolean {
    return this.map.has(TileCache.keyFor(tileId, genVersion));
  }

  set(tileId: number, genVersion: string, value: T): void {
    const key = TileCache.keyFor(tileId, genVersion);
    const previous = this.map.get(key);
    if (previous !== undefined) {
      this.map.delete(key);
      this.bytes -= this.sizeOf?.(previous) ?? 0;
    }
    this.map.set(key, value);
    this.bytes += this.sizeOf?.(value) ?? 0;
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) {
        break;
      }
      const evicted = this.map.get(oldest.value)!;
      this.map.delete(oldest.value);
      this.bytes -= this.sizeOf?.(evicted) ?? 0;
      this.evictions++;
      this.onEvict?.(evicted, oldest.value);
    }
  }

  /**
   * Protect a set of tiles from eviction by touching them in priority order.
   *
   * Called each frame with the visible cut, so the tiles currently on screen
   * are never the ones evicted to make room for tiles being streamed in — the
   * pathological case where the cache thrashes against its own working set.
   */
  touchAll(tileIds: Iterable<number>, genVersion: string): void {
    for (const id of tileIds) {
      const key = TileCache.keyFor(id, genVersion);
      const value = this.map.get(key);
      if (value !== undefined) {
        this.map.delete(key);
        this.map.set(key, value);
      }
    }
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.map) {
        this.onEvict(value, key);
      }
    }
    this.map.clear();
    this.bytes = 0;
  }

  stats(): CacheStats {
    return {
      size: this.map.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      bytes: this.bytes,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}
