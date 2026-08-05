import { describe, expect, it } from 'vitest';

import { GEN_VERSION } from '../src/index.js';
import { bandsForDepth, lodStepBound } from '../src/kernel/craters.js';
import { DEFAULT_FBM } from '../src/kernel/fbm.js';
import { interpretText } from '../src/ruleset/interpret.js';
import { Material } from '../src/kernel/regolith.js';
import { makeTileId, rootTiles, tileChild } from '../src/kernel/tileid.js';
import type { World } from '../src/spec.js';
import { TsTileGenerator } from '../src/tile/generator.js';

const WORLD: World = {
  spec: {
    ...interpretText('X800000-0'),
    radiusKm: 6371,
    terrainAmplitudeM: 8000,
    fbm: DEFAULT_FBM,
  },
  seedHi: 0xdeadbeef,
  seedLo: 0x12345678,
};

/**
 * The same world with no craters at all.
 *
 * Several properties here are about the *base terrain* and were written when
 * that was the only thing generated. They are still true and still worth
 * asserting; they are just no longer true of the whole surface.
 */
const CRATERLESS: World = {
  ...WORLD,
  spec: { ...WORLD.spec, craters: { ...WORLD.spec.craters, densityScale: 0 } },
};

const gen = new TsTileGenerator(GEN_VERSION);

describe('TsTileGenerator', () => {
  it('fills every buffer to the grid size', () => {
    const n = 16;
    const tile = gen.generate(makeTileId(0, 0, 0), WORLD, n);
    const count = (n + 1) * (n + 1);
    expect(tile.elevation.length).toBe(count);
    expect(tile.waterMask.length).toBe(count);
    expect(tile.materials.length).toBe(count);
    expect(tile.directions.length).toBe(count * 3);
    expect(tile.genVersion).toBe(GEN_VERSION);
    expect(tile.kind ?? 'typescript').toBe('typescript');
  });

  it('is reproducible', () => {
    const a = gen.generate(makeTileId(3, 4, 77), WORLD, 16);
    const b = gen.generate(makeTileId(3, 4, 77), WORLD, 16);
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
    expect(Array.from(a.materials)).toEqual(Array.from(b.materials));
  });

  it('produces no NaN or infinity', () => {
    for (const root of rootTiles()) {
      const tile = gen.generate(root, WORLD, 32);
      expect(tile.elevation.every(Number.isFinite)).toBe(true);
    }
  });

  it('bounds the BASE TERRAIN by the terrain amplitude', () => {
    // Normalisation makes amplitudeM a hard bound on the fBm relief — and on
    // that alone. See the crater test below for the half of the surface it does
    // not bound.
    const tile = gen.generate(makeTileId(0, 0, 0), CRATERLESS, 64);
    let max = 0;
    for (const e of tile.elevation) {
      max = Math.max(max, Math.abs(e));
    }
    expect(max).toBeLessThanOrEqual(CRATERLESS.spec.terrainAmplitudeM);
    expect(max).toBeGreaterThan(0);
  });

  it('lets craters go beyond it, because a crater is not made of terrain relief', () => {
    // `terrainAmplitudeM` is the fBm field's peak-to-trough figure, and WP10
    // made it stop being a bound on total elevation. A crater's depth comes from
    // its diameter and the world's gravity, so a basin on a geologically flat
    // world is deep *because the impact was large*, not because the world is
    // rough. Nothing caught this when craters landed — every test that could
    // have was looking at a tile the basins happened to miss.
    const tile = gen.generate(makeTileId(0, 3, 21), WORLD, 64);
    let max = 0;
    for (const e of tile.elevation) max = Math.max(max, Math.abs(e));
    expect(max).toBeGreaterThan(0);
    // Not unbounded, though: a sanity envelope, so a runaway profile is still
    // caught. The deepest thing on the sphere is the largest basin.
    expect(max).toBeLessThan(WORLD.spec.terrainAmplitudeM + 0.4 * 0.3 * WORLD.spec.radiusKm * 1000);
  });

  it('scales the base terrain with amplitude linearly, and craters not at all', () => {
    const withCraters = (spec: World['spec']): World => ({ ...WORLD, spec });
    const doubled = (w: World): World => ({
      ...w,
      spec: { ...w.spec, terrainAmplitudeM: w.spec.terrainAmplitudeM * 2 },
    });

    // Base terrain: exactly linear, as it always was.
    const a = gen.generate(makeTileId(1, 2, 5), CRATERLESS, 16);
    const b = gen.generate(makeTileId(1, 2, 5), doubled(CRATERLESS), 16);
    for (let i = 0; i < a.elevation.length; i++) {
      expect(b.elevation[i]).toBeCloseTo(a.elevation[i]! * 2, 9);
    }

    // With craters it is not, and the departure is the crater relief itself —
    // which is the assertion that stops the check above being satisfied by a
    // generator that ignored amplitude entirely.
    const c = gen.generate(makeTileId(1, 2, 5), withCraters(WORLD.spec), 16);
    const d = gen.generate(makeTileId(1, 2, 5), doubled(WORLD), 16);
    let departures = 0;
    for (let i = 0; i < c.elevation.length; i++) {
      if (Math.abs(d.elevation[i]! - c.elevation[i]! * 2) > 1e-6) departures++;
    }
    expect(departures).toBeGreaterThan(0);
  });

  it('gives different worlds for different seeds', () => {
    const other: World = { ...WORLD, seedLo: WORLD.seedLo + 1 };
    const a = gen.generate(makeTileId(0, 0, 0), WORLD, 16);
    const b = gen.generate(makeTileId(0, 0, 0), other, 16);
    let identical = 0;
    for (let i = 0; i < a.elevation.length; i++) {
      if (a.elevation[i] === b.elevation[i]) {
        identical++;
      }
    }
    // A handful of coincidences is fine; wholesale agreement is not.
    expect(identical).toBeLessThan(a.elevation.length * 0.05);
  });

  it('assigns only known material classes', () => {
    const valid = new Set(Object.values(Material) as number[]);
    const tile = gen.generate(makeTileId(4, 1, 2), WORLD, 32);
    for (const m of tile.materials) {
      expect(valid.has(m)).toBe(true);
    }
  });

  it('leaves the water mask empty (Phase 0 is airless worlds)', () => {
    const tile = gen.generate(makeTileId(2, 1, 1), WORLD, 16);
    expect(tile.waterMask.every((w) => w === 0)).toBe(true);
  });

  it('rejects non-power-of-two grids', () => {
    expect(() => gen.generate(makeTileId(0, 0, 0), WORLD, 65)).toThrow(/power of two/);
    expect(() => gen.generate(makeTileId(0, 0, 0), WORLD, 0)).toThrow(/power of two/);
  });

  it('reuses caller-supplied buffers', () => {
    const n = 8;
    const first = gen.generate(makeTileId(0, 0, 0), WORLD, n);
    const reused = gen.generate(makeTileId(5, 0, 0), WORLD, n, first);
    // Same underlying storage, refilled — this is what lets a worker pool avoid
    // allocating per tile.
    expect(reused.elevation).toBe(first.elevation);
  });
});

describe('seam-free generation', () => {
  it('adjacent tiles at the same LOD agree exactly on their shared edge', () => {
    // Two siblings sharing a vertical edge: child 0 (left) and child 1 (right)
    // of the same parent. The right column of one must equal the left column
    // of the other, bit for bit — this is the property that makes the terrain
    // continuous across tile boundaries.
    const n = 16;
    const parent = makeTileId(0, 2, 9);
    const left = gen.generate(tileChild(parent, 0), WORLD, n);
    const right = gen.generate(tileChild(parent, 1), WORLD, n);

    let compared = 0;
    for (let j = 0; j <= n; j++) {
      const leftEdge = j * (n + 1) + n; // rightmost column of the left tile
      const rightEdge = j * (n + 1); // leftmost column of the right tile
      expect(right.elevation[rightEdge], `row ${j}`).toBe(left.elevation[leftEdge]);
      compared++;
    }
    expect(compared).toBe(n + 1);
  });

  it('a tile and its refinement agree exactly where no crater band was added', () => {
    // Phase 0's LOD guarantee was absolute: splitting a tile did not move the
    // surface at all, because octave count is a spec parameter rather than a
    // function of depth.
    //
    // **WP10 weakened it, deliberately and by exactly one band.** A refinement
    // adds the crater band its parent could not resolve, so the surface does
    // move — that is what "deeper tiles add bands exactly as they add octaves"
    // means in practice. What must still hold is that it moves by *that band and
    // nothing else*, which is what `lodStepBound` states and what
    // `craters.test.ts` measures against the real field.
    //
    // Between two depths that gate identically, the old guarantee is unchanged
    // and is asserted here exactly.
    const n = 16;
    const parentId = makeTileId(1, 1, 1);
    expect(
      bandsForDepth(1),
      'depths 1 and 2 no longer share a band count; pick another pair',
    ).toBe(bandsForDepth(2));

    const parent = gen.generate(parentId, WORLD, n);
    const child = gen.generate(tileChild(parentId, 0), WORLD, n);

    let compared = 0;
    for (let j = 0; j <= n / 2; j++) {
      for (let i = 0; i <= n / 2; i++) {
        const p = j * (n + 1) + i;
        const c = j * 2 * (n + 1) + i * 2;
        expect(child.elevation[c], `vertex ${i},${j}`).toBe(parent.elevation[p]);
        compared++;
      }
    }
    expect(compared).toBe((n / 2 + 1) * (n / 2 + 1));
  });

  it('a refinement that adds a band moves the surface, and only within the bound', () => {
    // The other half. If a band gate opened and nothing moved, the band would
    // not be reaching generation at all — and every LOD test here would be
    // green over a planet with no crater detail below the first level.
    const n = 16;
    const parentId = makeTileId(1, 3, 21);
    expect(bandsForDepth(4)).toBe(bandsForDepth(3) + 1);

    const parent = gen.generate(parentId, WORLD, n);
    const child = gen.generate(tileChild(parentId, 0), WORLD, n);
    const bound = lodStepBound(4) * WORLD.spec.radiusKm * 1000;

    let moved = 0;
    for (let j = 0; j <= n / 2; j++) {
      for (let i = 0; i <= n / 2; i++) {
        const delta = Math.abs(
          child.elevation[j * 2 * (n + 1) + i * 2]! - parent.elevation[j * (n + 1) + i]!,
        );
        expect(delta, `vertex ${i},${j}`).toBeLessThan(bound);
        if (delta > 0) moved++;
      }
    }
    expect(moved, 'the added band changed nothing anywhere').toBeGreaterThan(0);
  });

  it('tiles on adjacent FACES agree exactly on the shared cube edge', () => {
    // The hardest seam: the join between two cube faces, where the two tiles
    // use different coordinate systems entirely and meet only because
    // tanWarp(±1) is exactly ±1.
    const n = 16;
    const a = gen.generate(makeTileId(0, 0, 0), WORLD, n); // +X face
    const b = gen.generate(makeTileId(4, 0, 0), WORLD, n); // +Z face

    // Find the shared edge by matching directions exactly, then require the
    // elevations at those vertices to match too.
    const key = (t: typeof a, i: number): string =>
      `${t.directions[i * 3]},${t.directions[i * 3 + 1]},${t.directions[i * 3 + 2]}`;

    const aByDir = new Map<string, number>();
    for (let i = 0; i < (n + 1) * (n + 1); i++) {
      aByDir.set(key(a, i), i);
    }

    let shared = 0;
    for (let i = 0; i < (n + 1) * (n + 1); i++) {
      const match = aByDir.get(key(b, i));
      if (match !== undefined) {
        expect(b.elevation[i]).toBe(a.elevation[match]);
        shared++;
      }
    }
    // The two faces share one full edge of the grid.
    expect(shared).toBe(n + 1);
  });
});
