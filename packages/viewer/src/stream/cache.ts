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

  /**
   * @param capacity Maximum tiles retained. Sized from the Spike B memory
   *                 numbers; too small and navigation re-generates constantly,
   *                 too large and a long session grows without bound.
   * @param onEvict  Called with each evicted value, so buffers can be returned
   *                 to a pool rather than left to the GC.
   */
  constructor(
    private readonly capacity: number,
    private readonly onEvict?: (value: T, key: string) => void,
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
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) {
        break;
      }
      const evicted = this.map.get(oldest.value)!;
      this.map.delete(oldest.value);
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
  }

  stats(): CacheStats {
    return {
      size: this.map.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}
