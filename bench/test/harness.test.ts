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
import {
  TsTileGenerator,
  allocateTileOutput,
  bandsForDepth,
  faceUvToDirection,
  fbm3,
  fbmNormalisation,
  makeTileId,
  tileBounds,
  tileDepth,
  tileFace,
} from '@traveller-mainworld/core';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bytes, ms, time } from '../src/harness.js';
import { footprint } from '../src/memory.js';
import { DEFAULT_PHASE, resolveOutput } from '../src/output.js';
import { benchBasins, benchByDepth, benchDensity } from '../src/tile.js';
import {
  BENCH_DENSITY,
  BENCH_FBM,
  BENCH_WORLD,
  benchTiles,
  renderBytes,
  tileBytes,
  tilesAtDepth,
  vertexCount,
  worldAtDensity,
} from '../src/workloads.js';

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

describe('the crater density differential', () => {
  // WP15 replaced Phase 0's standalone crater cost model — a second
  // implementation of a similar workload — with a differential across
  // `densityScale` on the shipped generator. The whole measurement rests on one
  // claim: that the zero arm has no craters in it. These tests are that claim.
  const n = 32;
  const id = makeTileId(0, 5, 300);

  function elevationAt(densityScale: number): number[] {
    const out = allocateTileOutput(n);
    new TsTileGenerator('bench').generate(id, worldAtDensity(densityScale), n, out);
    return Array.from(out.elevation);
  }

  it('leaves exactly the base terrain field at density 0', () => {
    // Not "smaller" or "smoother" — equal, to the bit, to the fBm pass alone.
    // Anything the acceptance hash let through would show up here, and a
    // differential whose baseline still contains craters understates them.
    const { u0, v0, size } = tileBounds(id);
    const face = tileFace(id);
    const { fbm, terrainAmplitudeM } = BENCH_WORLD.spec;
    const seed = (BENCH_WORLD.seedLo ^ Math.imul(BENCH_WORLD.seedHi, 0x9e3779b1)) | 0;
    const norm = fbmNormalisation(fbm);
    const scale = norm === 0 ? 0 : terrainAmplitudeM / norm;

    const expected: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const d = faceUvToDirection(face, u0 + (i / n) * size, v0 + (j / n) * size);
        expected.push(fbm3(d.x, d.y, d.z, seed, fbm) * scale);
      }
    }

    expect(elevationAt(0)).toEqual(expected);
  });

  it('measures a difference at all', () => {
    // The failure this guards is the one Phase 0's model hit from the other
    // side: a pass that silently does nothing looks like excellent performance.
    // If the two arms were equal the differential would report craters as free.
    expect(elevationAt(BENCH_DENSITY)).not.toEqual(elevationAt(0));
  });

  it('holds everything but the density fixed', () => {
    const world = worldAtDensity(0.25);
    expect(world.spec.craters.densityScale).toBe(0.25);
    expect(world.seedHi).toBe(BENCH_WORLD.seedHi);
    expect(world.seedLo).toBe(BENCH_WORLD.seedLo);
    expect(world.spec.fbm).toEqual(BENCH_WORLD.spec.fbm);
    expect(world.spec.radiusKm).toBe(BENCH_WORLD.spec.radiusKm);
    expect(world.spec.craters.transitionDiameterKm).toBe(
      BENCH_WORLD.spec.craters.transitionDiameterKm,
    );
    expect(world.spec.craters.regolithMaturity).toBe(BENCH_WORLD.spec.craters.regolithMaturity);
  });

  it('benchmarks the saturated case, and says so', () => {
    // `X800000-0` is Atmosphere 0. If the ruleset ever interprets it to
    // something less than saturated, the results file's "this is the expensive
    // case" paragraph becomes false and nothing else would notice.
    expect(BENCH_DENSITY).toBe(1);
  });
});

describe('the per-depth breakdown', () => {
  it('puts one tile on every face at the depth asked for', () => {
    for (const depth of [0, 3, 6]) {
      const tiles = tilesAtDepth(depth);
      expect(new Set(tiles.map(tileFace)).size, `depth ${depth}`).toBe(6);
      expect(tiles.every((id) => tileDepth(id) === depth), `depth ${depth}`).toBe(true);
    }
  });

  it('spans depths where the band gate actually moves', () => {
    // The table is there to show cost rising with depth. If every depth it
    // covered admitted the same number of bands, it would be six rows of the
    // same measurement with a column that implies otherwise.
    const bands = [0, 1, 2, 3, 4, 5, 6].map(bandsForDepth);
    expect(bands[6]).toBeGreaterThan(bands[0]!);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i], `depth ${i}`).toBeGreaterThanOrEqual(bands[i - 1]!);
    }
  });
});

describe('the benchmarks measure what their parameters say', () => {
  // Timings cannot carry this: a benchmark that ignored its own parameter would
  // return three plausible, slightly different numbers and no other symptom.
  // The checksums are what make it checkable without asserting on a duration.
  it('generates a different world at each density', () => {
    const sums = [1, 0.5, 0].map((d) => benchDensity(16, d, 1).checksum);
    expect(new Set(sums).size, `checksums ${JSON.stringify(sums)}`).toBe(3);
  });

  it('generates a different tile set at each depth', () => {
    const rows = benchByDepth(16, 3, 1);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3]);
    expect(new Set(rows.map((r) => r.checksum)).size).toBe(rows.length);
  });
});

describe('the basin field measurement', () => {
  it('places basins rather than timing an empty loop', () => {
    const row = benchBasins(3);
    expect(row.count).toBeGreaterThan(0);
    expect(row.timing.medianMs).toBeGreaterThan(0);
  });
});

describe('results path', () => {
  // Asserted on the **basename**, because that is what `resolveOutput` decides —
  // joining it to a directory is `node:path`'s job, and `path.join` is
  // platform-dependent. The first version of these tests compared against
  // `'/r/phase1.md'`, passed on Linux and macOS, and turned the Windows CI cell
  // red on `\r\phase1.md`. A test that encodes a path separator is testing the
  // runner's operating system.
  const nameFor = (argv: readonly string[]): string => basename(resolveOutput(argv, '/r').path);

  it('defaults to the current phase, and separates quick runs', () => {
    expect(nameFor([])).toBe(`phase${String(DEFAULT_PHASE)}.md`);
    expect(nameFor(['--quick'])).toBe(`phase${String(DEFAULT_PHASE)}-quick.md`);
    expect(resolveOutput([], '/r').phase).toBe(DEFAULT_PHASE);
  });

  it('writes into the directory it is given', () => {
    // The other half of the path, kept as its own assertion so the basename
    // tests above do not have to care how the two are joined.
    expect(dirname(resolveOutput([], '/results/here').path)).toBe(join('/results/here'));
  });

  it('refuses to write phase0.md', () => {
    // The file ADR-0001 §E2 cites, and the one WP14 nearly lost. A flag that
    // targets it is a mistake every time: the tile it measured had no crater
    // pass, so no run on this kernel reproduces it.
    expect(() => resolveOutput(['--phase=0'], '/r')).toThrow(/refusing/);
    expect(() => resolveOutput(['--phase=0', '--quick'], '/r')).toThrow(/refusing/);
  });

  it('lets an explicit --out through, including past the phase-0 guard', () => {
    // A guard with no way past it is a guard someone deletes.
    expect(nameFor(['--out=scratch.md'])).toBe('scratch.md');
    expect(nameFor(['--phase=0', '--out=redo.md'])).toBe('redo.md');
    expect(resolveOutput(['--phase=0', '--out=redo.md'], '/r').phase).toBe(0);
  });

  it('rejects a phase that is not a non-negative integer', () => {
    expect(() => resolveOutput(['--phase=one'], '/r')).toThrow(/non-negative integer/);
    expect(() => resolveOutput(['--phase=-1'], '/r')).toThrow(/non-negative integer/);
    expect(() => resolveOutput(['--phase=1.5'], '/r')).toThrow(/non-negative integer/);
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
