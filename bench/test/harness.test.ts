/**
 * Tests for the benchmark harness.
 *
 * A benchmark is measurement code, and unmeasured measurement code reports
 * whatever it likes. Three of the numbers in the first draft of
 * `results/phase0.md` were wrong — a crater model that visited four million
 * cells per tile, a memory figure reading a counter that does not include
 * typed-array data, and a transfer timing dominated by allocation — and none of
 * them looked wrong in the table. These tests pin the properties that would
 * have caught them.
 */
import { TsTileGenerator, allocateTileOutput, makeTileId, tileBounds, tileChild, tileFace } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CRATER_BANDS,
  bandIsResolvable,
  compositeCraters,
  globalCraterPass,
} from '../src/craters.js';
import { bytes, ms, time } from '../src/harness.js';
import { footprint } from '../src/memory.js';
import { BENCH_FBM, BENCH_WORLD, benchTiles, renderBytes, tileBytes, vertexCount } from '../src/workloads.js';

describe('timing harness', () => {
  it('reports a cost that tracks the actual work', () => {
    // Two workloads 20× apart must come out at least 3× apart. The margin is
    // wide on purpose, and both workloads are sized to take milliseconds rather
    // than microseconds: the first version of this test used a 2,000-iteration
    // loop, landed at 0.4 ms, and failed under a parallel test runner because
    // scheduler noise was larger than the signal.
    //
    // `minMs`, not the median: the fastest sample is the one least polluted by
    // whatever else the machine is doing, which is exactly what a timing
    // assertion inside a unit-test suite needs.
    const cheap = time('cheap', () => spin(300_000), { warmup: 2, iterations: 9 });
    const dear = time('dear', () => spin(6_000_000), { warmup: 2, iterations: 9 });
    expect(cheap.minMs).toBeGreaterThan(0);
    expect(dear.minMs).toBeGreaterThan(cheap.minMs * 3);
  });

  it('orders min <= median <= p95', () => {
    const t = time('ordering', () => spin(300_000), { warmup: 2, iterations: 15 });
    expect(t.minMs).toBeLessThanOrEqual(t.medianMs);
    expect(t.medianMs).toBeLessThanOrEqual(t.p95Ms);
  });

  it('derives per-op figures from opsPerIteration', () => {
    const t = time('per-op', () => spin(300_000), { warmup: 1, iterations: 5, opsPerIteration: 10 });
    expect(t.msPerOp).toBeCloseTo(t.medianMs / 10, 10);
    expect(t.opsPerSecond).toBeCloseTo(10_000 / t.medianMs, 6);
  });

  it('never reports zero for work that actually happened', () => {
    // The dead-code failure mode. If the sink stopped working, an optimiser
    // could delete `spin` entirely and this would drop to 0.
    const t = time('nonzero', () => spin(2_000_000), { warmup: 2, iterations: 5 });
    expect(t.medianMs).toBeGreaterThan(0);
  });

  it('formats durations and byte counts readably', () => {
    expect(ms(1234)).toBe('1234');
    expect(ms(12.34)).toBe('12.3');
    expect(ms(0.001234)).toBe('0.001');
    expect(ms(NaN)).toBe('n/a');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KiB');
    expect(bytes(5 * 1024 * 1024)).toBe('5.0 MiB');
  });
});

/** A workload the optimiser cannot fold away, whose cost scales with `n`. */
function spin(n: number): number {
  let acc = 0;
  for (let i = 1; i <= n; i++) {
    acc += Math.sqrt(i) / i;
  }
  return acc;
}

describe('tile footprint arithmetic', () => {
  it('matches the buffers the kernel actually allocates', () => {
    for (const n of [64, 128]) {
      const out = allocateTileOutput(n);
      const expected = tileBytes(n);
      expect(out.elevation.byteLength, `elevation n=${n}`).toBe(expected.elevation);
      expect(out.waterMask.byteLength, `waterMask n=${n}`).toBe(expected.waterMask);
      expect(out.materials.byteLength, `materials n=${n}`).toBe(expected.materials);
      expect(out.directions.byteLength, `directions n=${n}`).toBe(expected.directions);
    }
  });

  it('counts renderer-ready bytes for the grid plus eight skirt rings', () => {
    // Mirrors `viewer/src/mesh/tileMesh.ts`. If that formula changes, the LRU
    // sizing advice in the results doc silently becomes wrong.
    for (const n of [64, 128]) {
      const verts = (n + 1) * (n + 1) + 8 * (n + 1);
      expect(renderBytes(n)).toBe(verts * 3 * 4 * 2);
    }
  });

  it('reports a tile budget that divides 256 MiB correctly', () => {
    const f = footprint(128);
    expect(f.tilesPer256MiB * f.renderBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
    expect((f.tilesPer256MiB + 1) * f.renderBytes).toBeGreaterThan(256 * 1024 * 1024);
  });
});

describe('crater cost model', () => {
  const n = 32;

  function crateredEdge(tileId: number, edge: 'right' | 'left'): number[] {
    const b = tileBounds(tileId);
    const out = allocateTileOutput(n);
    new TsTileGenerator('bench').generate(tileId, BENCH_WORLD, n, out);
    compositeCraters(out, tileFace(tileId), b.u0, b.v0, b.size, n, BENCH_WORLD.spec.terrainAmplitudeM);
    const col = edge === 'right' ? n : 0;
    const values: number[] = [];
    for (let j = 0; j <= n; j++) values.push(out.elevation[j * (n + 1) + col]!);
    return values;
  }

  it('is seam-free across a tile boundary', () => {
    // The property that makes cell-hashed placement the right *shape* for a
    // cost model. Drawing craters from a per-tile RNG stream would be cheaper
    // to write and faster to run, and would put a cliff along every tile edge —
    // so a model built that way would be measuring the wrong algorithm.
    const parent = makeTileId(2, 3, 21);
    const left = tileChild(parent, 0); // lower-left quadrant
    const right = tileChild(parent, 1); // lower-right, sharing left's right edge

    const a = crateredEdge(left, 'right');
    const b = crateredEdge(right, 'left');
    expect(b).toEqual(a);
  });

  it('is deterministic', () => {
    const id = benchTiles(1)[0]!;
    expect(crateredEdge(id, 'right')).toEqual(crateredEdge(id, 'right'));
  });

  it('actually modifies the terrain', () => {
    // Guards the case where every band is skipped as unresolvable and the pass
    // silently becomes free — which is what the first version of this model did
    // at shallow depths, and it looked like excellent performance.
    const id = makeTileId(0, 5, 300);
    const b = tileBounds(id);
    const out = allocateTileOutput(n);
    new TsTileGenerator('bench').generate(id, BENCH_WORLD, n, out);
    const before = Array.from(out.elevation);
    const stats = compositeCraters(out, 0, b.u0, b.v0, b.size, n, 8000);

    expect(stats.cratersPlaced).toBeGreaterThan(0);
    expect(stats.vertexUpdates).toBeGreaterThan(0);
    expect(Array.from(out.elevation)).not.toEqual(before);
  });

  it('skips bands finer than the vertex spacing, and keeps coarser ones', () => {
    const fine = DEFAULT_CRATER_BANDS[DEFAULT_CRATER_BANDS.length - 1]!;
    const coarse = DEFAULT_CRATER_BANDS[0]!;
    // A depth-0 tile spans the whole face: one vertex per 1/128 of it.
    expect(bandIsResolvable(fine, 1, 128)).toBe(false);
    expect(bandIsResolvable(coarse, 1, 128)).toBe(true);
    // A depth-6 tile spans 1/64 of the face, where the fine band is resolvable.
    expect(bandIsResolvable(fine, 1 / 64, 128)).toBe(true);
  });

  it('keeps cell counts bounded at every depth', () => {
    // The bug this model started with: without the resolvability gate, a
    // depth-0 tile visited 2048² cells of the finest band — four million hash
    // lookups for features a thousand times smaller than a vertex.
    for (let depth = 0; depth <= 6; depth++) {
      let path = 0;
      for (let d = 0; d < depth; d++) path = path * 4 + 1;
      const id = makeTileId(0, depth, path);
      const b = tileBounds(id);
      const out = allocateTileOutput(64);
      const stats = compositeCraters(out, 0, b.u0, b.v0, b.size, 64, 8000);
      expect(stats.cellsVisited, `depth ${depth}`).toBeLessThan(50_000);
    }
  });

  it('places a plausible number of craters in the global pass', () => {
    const placed = globalCraterPass(64, 0.02);
    const cells = 6 * 64 * 64;
    // Within a factor of two of the requested density; the hash is uniform but
    // this is a finite sample.
    expect(placed).toBeGreaterThan(cells * 0.01);
    expect(placed).toBeLessThan(cells * 0.04);
  });
});

describe('bench workload definition', () => {
  it('uses the 10-octave tile the spike plan specifies, not the 8-octave default', () => {
    expect(BENCH_FBM.octaves).toBe(10);
    expect(BENCH_WORLD.spec.fbm.octaves).toBe(10);
  });

  it('spreads tiles across every face and a range of depths', () => {
    const tiles = benchTiles(24);
    expect(new Set(tiles.map(tileFace)).size).toBe(6);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('counts vertices as (n+1)²', () => {
    expect(vertexCount(64)).toBe(65 * 65);
    expect(vertexCount(128)).toBe(129 * 129);
  });
});
