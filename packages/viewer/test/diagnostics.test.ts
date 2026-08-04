import { describe, expect, it } from 'vitest';

import {
  type EvidenceStamp,
  type HeapBaseline,
  type StampEnvironment,
  memoryLines,
  stampLines,
} from '../src/diagnostics/overlay.js';
import { PlanetRenderer } from '../src/render/planet.js';
import type { ReadyTile } from '../src/stream/tileStore.js';
import { vertexCount } from '../src/mesh/tileMesh.js';

const SAMPLE = {
  cacheBytes: 128 << 20,
  cacheSize: 302,
  meshLiveBytes: 96 << 20,
  meshPooledBytes: 40 << 20,
  meshSharedBytes: 1 << 20,
  pooledMeshes: 128,
};

describe('memoryLines', () => {
  it('says the heap is unavailable rather than reporting a zero', () => {
    const [heap] = memoryLines(SAMPLE, undefined, undefined, 0);
    // The failure this guards against is a panel that shows "heap 0 KiB" on
    // Firefox and Safari, which reads as a measurement and is not one.
    expect(heap).toMatch(/not reported/);
    expect(heap).toMatch(/Chrome-only/);
    expect(heap).not.toMatch(/\d+(\.\d+)? (KiB|MiB|GiB)/);
  });

  it('reports the heap against its limit, marked as main-thread only', () => {
    const [heap] = memoryLines(
      SAMPLE,
      { usedJSHeapSize: 412 << 20, jsHeapSizeLimit: 4 * 1024 ** 3 },
      undefined,
      0,
    );
    expect(heap).toContain('412.0 MiB');
    expect(heap).toContain('4.00 GiB');
    // Worker heaps are invisible to performance.memory, and tile generation
    // lives in workers. The caveat has to travel with the number.
    expect(heap).toContain('main thread only');
  });

  it('reports drift against the baseline, signed, over the elapsed time', () => {
    const baseline: HeapBaseline = { usedBytes: 400 << 20, atMs: 3_000 };
    const [heap] = memoryLines(
      SAMPLE,
      { usedJSHeapSize: 437 << 20, jsHeapSizeLimit: 4 * 1024 ** 3 },
      baseline,
      555_000,
    );
    expect(heap).toContain('+37.0 MiB');
    // Elapsed is measured from the baseline, not from page load: 555 s - 3 s.
    expect(heap).toContain('over 9m 12s');
  });

  it('signs a shrinking heap negative, so a GC does not read as growth', () => {
    const baseline: HeapBaseline = { usedBytes: 400 << 20, atMs: 0 };
    const [heap] = memoryLines(
      SAMPLE,
      { usedJSHeapSize: 380 << 20, jsHeapSizeLimit: 4 * 1024 ** 3 },
      baseline,
      60_000,
    );
    expect(heap).toContain('-20.0 MiB');
    expect(heap).not.toContain('+');
  });

  it('reports resident bytes and the session clock', () => {
    const [, resident, session] = memoryLines(SAMPLE, undefined, undefined, 624_000);
    expect(resident).toContain('128.0 MiB tiles (302)');
    expect(resident).toContain('96.0 MiB mesh live');
    expect(resident).toContain('40.0 MiB pooled (128)');
    expect(session).toContain('10m 24s');
  });
});

describe('stampLines', () => {
  const STAMP: EvidenceStamp = {
    world: 'fixture size8-earthlike — 6371 km radius, 20000 m relief, 12 octaves',
    worldShort: 'size8-earthlike',
    build: 'db0cac8a1b2c3d4e5f60718293a4b5c6d7e8f900',
    tileN: 64,
    exaggeration: 1,
  };
  const ENV: StampEnvironment = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    screenWidth: 1920,
    screenHeight: 1080,
    devicePixelRatio: 1,
    at: new Date('2026-08-04T15:00:00.000Z'),
  };
  const find = (lines: string[], label: string): string =>
    lines.find((l) => l.startsWith(label)) ?? `no '${label}' line`;

  it('records what produced the numbers, in full', () => {
    const lines = stampLines(STAMP, ENV);
    // The full commit, not the abbreviation — an abbreviation is for reading,
    // and this block is for citing.
    expect(find(lines, 'build')).toContain(STAMP.build);
    expect(find(lines, 'world')).toContain('size8-earthlike');
    expect(find(lines, 'user agent')).toContain('Chrome/150.0.0.0');
    expect(find(lines, 'hardware')).toContain('cores 8, memory 8 GB');
    expect(find(lines, 'screen')).toContain('1920×1080 @ 1');
    expect(find(lines, 'run at')).toContain('2026-08-04T15:00:00.000Z');
  });

  it('names the mesh resolution the session actually ran at', () => {
    // 65² mesh against 129² hashed generation is open question 1, so a block
    // that does not say which one it flew cannot settle it.
    expect(find(stampLines(STAMP, ENV), 'tile mesh')).toContain('65² (TILE_N 64)');
  });

  it('flags an exaggeration override loudly, and true scale plainly', () => {
    expect(find(stampLines(STAMP, ENV), 'exaggeration')).toContain('1 (true scale)');
    const override = stampLines({ ...STAMP, exaggeration: 20 }, ENV);
    // A frame rate measured at 20× exaggeration is not a measurement of the
    // shipped view, and the block must not let that pass unremarked.
    expect(find(override, 'exaggeration')).toContain('OVERRIDE');
  });

  it('says memory is unreported rather than inventing a figure', () => {
    const lines = stampLines(STAMP, { ...ENV, deviceMemoryGb: undefined });
    expect(find(lines, 'hardware')).toContain('memory not reported');
    expect(find(lines, 'hardware')).not.toMatch(/memory \d/);
  });

  it('leaves a local build named as one', () => {
    const lines = stampLines({ ...STAMP, build: 'local build' }, ENV);
    expect(find(lines, 'build')).toContain('local build');
  });
});

describe('PlanetRenderer buffer accounting', () => {
  const N = 8;
  const tileFor = (tileId: number): ReadyTile => {
    const verts = vertexCount(N);
    return {
      tileId,
      n: N,
      positions: new Float32Array(verts * 3).fill(1),
      colours: new Float32Array(verts * 3),
      minElevation: 0,
      maxElevation: 1,
    };
  };
  // Two Float32 attributes of three components each, per vertex.
  const perMesh = vertexCount(N) * 3 * 4 * 2;

  it('counts live meshes, and moves them to pooled rather than freeing them', () => {
    const planet = new PlanetRenderer({ n: N });
    planet.upsert(tileFor(1));
    planet.upsert(tileFor(2));
    expect(planet.bufferBytes.live).toBe(2 * perMesh);
    expect(planet.bufferBytes.pooled).toBe(0);

    planet.retainOnly(new Set([1]));
    // The retired mesh is still allocated — that is the point of the pool, and
    // a readout that showed it as freed would hide real resident memory.
    expect(planet.bufferBytes.live).toBe(perMesh);
    expect(planet.bufferBytes.pooled).toBe(perMesh);
    expect(planet.pooledCount).toBe(1);

    planet.dispose();
  });

  it('counts the shared index buffers once, not once per mesh', () => {
    const planet = new PlanetRenderer({ n: N });
    const shared = planet.bufferBytes.shared;
    expect(shared).toBeGreaterThan(0);
    for (let i = 1; i <= 5; i++) {
      planet.upsert(tileFor(i));
    }
    expect(planet.bufferBytes.shared).toBe(shared);
    planet.dispose();
  });

  it('stops growing once the pool is full', () => {
    // The pool bound is what makes "resident bytes stopped rising" a real
    // statement about a long session rather than a coincidence of timing.
    const planet = new PlanetRenderer({ n: N, poolSize: 2 });
    for (let i = 1; i <= 6; i++) {
      planet.upsert(tileFor(i));
    }
    planet.retainOnly(new Set());
    expect(planet.pooledCount).toBe(2);
    expect(planet.bufferBytes.pooled).toBe(2 * perMesh);
    expect(planet.bufferBytes.live).toBe(0);
    planet.dispose();
  });
});
