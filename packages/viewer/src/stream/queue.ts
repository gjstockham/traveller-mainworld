/**
 * Priority queue for tile requests, ordered by camera relevance.
 *
 * A binary heap rather than a sorted array: the queue is re-prioritised every
 * frame as the camera moves, so insertion cost matters more than iteration.
 * Lower `priority` values are served first — priority is screen-space error
 * inverted, so the tile whose absence is most visible is generated next.
 */

interface Entry {
  readonly key: number;
  priority: number;
}

export class PriorityQueue {
  private heap: Entry[] = [];
  /** Position of each key in the heap, so `reprioritise` and `remove` are O(log n). */
  private index = new Map<number, number>();

  get size(): number {
    return this.heap.length;
  }

  has(key: number): boolean {
    return this.index.has(key);
  }

  /** Insert, or update the priority of an existing key. */
  push(key: number, priority: number): void {
    const existing = this.index.get(key);
    if (existing !== undefined) {
      const entry = this.heap[existing]!;
      const previous = entry.priority;
      entry.priority = priority;
      if (priority < previous) {
        this.siftUp(existing);
      } else if (priority > previous) {
        this.siftDown(existing);
      }
      return;
    }
    this.heap.push({ key, priority });
    this.index.set(key, this.heap.length - 1);
    this.siftUp(this.heap.length - 1);
  }

  /** Remove and return the highest-priority key, or `undefined` if empty. */
  pop(): number | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    this.index.delete(top.key);
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.index.set(last.key, 0);
      this.siftDown(0);
    }
    return top.key;
  }

  /** Remove a specific key. Returns whether it was present. */
  remove(key: number): boolean {
    const i = this.index.get(key);
    if (i === undefined) {
      return false;
    }
    const last = this.heap.pop()!;
    this.index.delete(key);
    if (i < this.heap.length) {
      this.heap[i] = last;
      this.index.set(last.key, i);
      this.siftDown(i);
      this.siftUp(i);
    }
    return true;
  }

  /**
   * Drop every queued key not in `keep`.
   *
   * This is the cancellation path: when the camera moves, tiles that are no
   * longer wanted are dropped before a worker ever starts on them. Work already
   * in flight is left alone — the result is still a valid tile and gets cached
   * rather than thrown away.
   */
  retainOnly(keep: ReadonlySet<number>): number {
    const doomed: number[] = [];
    for (const key of this.index.keys()) {
      if (!keep.has(key)) {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      this.remove(key);
    }
    return doomed.length;
  }

  clear(): void {
    this.heap = [];
    this.index.clear();
  }

  /** Snapshot of queued keys, for diagnostics. Order is heap order, not sorted. */
  keys(): number[] {
    return this.heap.map((e) => e.key);
  }

  private siftUp(start: number): void {
    let i = start;
    const entry = this.heap[i]!;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = this.heap[parent]!;
      if (p.priority <= entry.priority) {
        break;
      }
      this.heap[i] = p;
      this.index.set(p.key, i);
      i = parent;
    }
    this.heap[i] = entry;
    this.index.set(entry.key, i);
  }

  private siftDown(start: number): void {
    let i = start;
    const entry = this.heap[i]!;
    const n = this.heap.length;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) {
        break;
      }
      const right = left + 1;
      const child = right < n && this.heap[right]!.priority < this.heap[left]!.priority ? right : left;
      const c = this.heap[child]!;
      if (c.priority >= entry.priority) {
        break;
      }
      this.heap[i] = c;
      this.index.set(c.key, i);
      i = child;
    }
    this.heap[i] = entry;
    this.index.set(entry.key, i);
  }
}
