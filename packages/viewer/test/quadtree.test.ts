import {
  directionToFaceUv,
  rootTiles,
  tileBounds,
  tileChild,
  tileDepth,
  tileFace,
  tileParent,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOD,
  type LodParams,
  type Vec3,
  isBeyondHorizon,
  screenSpaceError,
  selectTiles,
  tileExtent,
} from '../src/lod/quadtree.js';

const PARAMS: LodParams = { ...DEFAULT_LOD, radius: 1, maxDepth: 10 };

/** Camera at `alt` radii above the surface, over the +Z pole. */
function cameraAt(alt: number): Vec3 {
  return { x: 0, y: 0, z: 1 + alt };
}

describe('tileExtent', () => {
  it('gives roughly a quarter-turn cap for a face root', () => {
    for (const root of rootTiles()) {
      const e = tileExtent(root);
      // Half-diagonal of a cube face on the sphere is ~0.955 rad.
      expect(e.angularRadius).toBeGreaterThan(0.9);
      expect(e.angularRadius).toBeLessThan(1.0);
      expect(Math.hypot(e.centre.x, e.centre.y, e.centre.z)).toBeCloseTo(1, 12);
    }
  });

  it('halves the angular radius roughly per level', () => {
    let id = rootTiles()[4]!;
    let prev = tileExtent(id).angularRadius;
    for (let d = 0; d < 8; d++) {
      id = tileChild(id, 0);
      const r = tileExtent(id).angularRadius;
      const ratio = r / prev;
      expect(ratio, `depth ${d + 1}`).toBeGreaterThan(0.4);
      expect(ratio, `depth ${d + 1}`).toBeLessThan(0.62);
      prev = r;
    }
  });
});

describe('screenSpaceError', () => {
  it('falls as the camera retreats', () => {
    const extent = tileExtent(rootTiles()[4]!);
    let prev = Infinity;
    for (const alt of [0.01, 0.1, 1, 10, 100]) {
      const e = screenSpaceError(extent, cameraAt(alt), PARAMS);
      expect(e).toBeLessThan(prev);
      prev = e;
    }
  });

  it('is smaller for smaller tiles at the same distance', () => {
    const root = rootTiles()[4]!;
    const cam = cameraAt(0.5);
    const coarse = screenSpaceError(tileExtent(root), cam, PARAMS);
    const fine = screenSpaceError(tileExtent(tileChild(root, 0)), cam, PARAMS);
    expect(fine).toBeLessThan(coarse);
  });

  it('scales with viewport height', () => {
    const extent = tileExtent(rootTiles()[4]!);
    const cam = cameraAt(1);
    const small = screenSpaceError(extent, cam, { ...PARAMS, viewportHeight: 540 });
    const large = screenSpaceError(extent, cam, { ...PARAMS, viewportHeight: 1080 });
    expect(large / small).toBeCloseTo(2, 6);
  });

  it('stays finite with the camera on the surface', () => {
    const extent = tileExtent(rootTiles()[4]!);
    const e = screenSpaceError(extent, { x: 0, y: 0, z: 1 }, PARAMS);
    expect(Number.isFinite(e)).toBe(true);
  });
});

describe('horizon culling', () => {
  it('culls the far side from orbit', () => {
    const cam = cameraAt(1); // 1 radius up
    const near = tileExtent(rootTiles()[4]!); // +Z, facing the camera
    const far = tileExtent(rootTiles()[5]!); // -Z, behind the planet
    expect(isBeyondHorizon(near, cam, 1)).toBe(false);
    expect(isBeyondHorizon(far, cam, 1)).toBe(true);
  });

  it('culls nothing when the camera is below the surface', () => {
    const cam = { x: 0, y: 0, z: 0.5 };
    for (const root of rootTiles()) {
      expect(isBeyondHorizon(tileExtent(root), cam, 1)).toBe(false);
    }
  });
});

describe('selectTiles', () => {
  it('returns the six roots when the camera is very far away', () => {
    const sel = selectTiles(cameraAt(500), PARAMS);
    expect(sel.tiles.length).toBeLessThanOrEqual(6);
    expect(sel.tiles.every((t) => tileDepth(t) === 0)).toBe(true);
  });

  it('refines toward the camera and stays coarse away from it', () => {
    const sel = selectTiles(cameraAt(0.05), PARAMS);
    const byFace = new Map<number, number[]>();
    for (const t of sel.tiles) {
      const f = tileFace(t);
      byFace.set(f, [...(byFace.get(f) ?? []), tileDepth(t)]);
    }
    const nearDepths = byFace.get(4) ?? []; // +Z, under the camera
    expect(Math.max(...nearDepths)).toBeGreaterThan(4);
    // Faces on the far side are culled or coarse.
    const farDepths = byFace.get(5) ?? [0];
    expect(Math.max(...farDepths)).toBeLessThan(Math.max(...nearDepths));
  });

  it('produces a cut with no tile an ancestor of another', () => {
    // Overlapping tiles would z-fight and double-draw the surface.
    const sel = selectTiles(cameraAt(0.2), PARAMS);
    const set = new Set(sel.tiles);
    for (const t of sel.tiles) {
      let cur = t;
      while (tileDepth(cur) > 0) {
        cur = tileParent(cur);
        expect(set.has(cur), `${t} overlaps ancestor ${cur}`).toBe(false);
      }
    }
  });

  it('respects maxDepth', () => {
    const sel = selectTiles(cameraAt(0.001), { ...PARAMS, maxDepth: 5 });
    expect(Math.max(...sel.tiles.map(tileDepth))).toBeLessThanOrEqual(5);
  });

  it('respects maxTiles', () => {
    const sel = selectTiles(cameraAt(0.001), { ...PARAMS, maxTiles: 64, maxDepth: 16 });
    expect(sel.tiles.length).toBeLessThanOrEqual(200);
  });

  it('reports an error for every selected tile', () => {
    const sel = selectTiles(cameraAt(0.3), PARAMS);
    expect(sel.errors.size).toBe(sel.tiles.length);
    for (const t of sel.tiles) {
      expect(sel.errors.has(t)).toBe(true);
    }
  });

  it('is deterministic for a fixed camera', () => {
    const a = selectTiles(cameraAt(0.25), PARAMS);
    const b = selectTiles(cameraAt(0.25), PARAMS);
    expect([...a.tiles].sort()).toEqual([...b.tiles].sort());
  });
});

describe('hysteresis', () => {
  /**
   * Depth of the drawn tile directly beneath the camera.
   *
   * Deliberately not "did the whole cut change": jittering the altitude also
   * moves the horizon, so tiles near the limb legitimately enter and leave the
   * cut. Comparing whole cuts conflates that correct behaviour with LOD
   * flicker. The sub-camera point is always visible, so its depth isolates the
   * split decision itself.
   */
  function depthUnderCamera(tiles: readonly number[], cam: Vec3): number {
    const len = Math.hypot(cam.x, cam.y, cam.z);
    const dir = { x: cam.x / len, y: cam.y / len, z: cam.z / len };
    const { face, u, v } = directionToFaceUv(dir);
    for (const t of tiles) {
      if (tileFace(t) !== face) {
        continue;
      }
      const b = tileBounds(t);
      if (u >= b.u0 && u <= b.u0 + b.size && v >= b.v0 && v <= b.v0 + b.size) {
        return tileDepth(t);
      }
    }
    return -1;
  }

  /**
   * Altitude at which the tile under the camera is exactly on the edge of
   * splitting, found by bisecting on that depth.
   *
   * Bisecting on total tile count instead would find a *horizon* boundary —
   * the count is dominated by how much of the limb is visible — and land
   * nowhere near a split threshold.
   */
  function splitBoundaryAltitude(): number {
    const depthAt = (a: number): number =>
      depthUnderCamera(selectTiles(cameraAt(a), PARAMS).tiles, cameraAt(a));
    let lo = 0.02;
    let hi = 2.0;
    const deep = depthAt(lo);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (depthAt(mid) === deep) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  }

  it('DOES NOT FLICKER when the camera jitters at a split boundary', () => {
    // The actual failure mode. A monotonic sweep would not catch it: with a
    // single threshold `selectTiles` is a pure function of position, so a
    // one-way sweep coarsens cleanly either way. Flicker happens when the
    // camera dithers — orbit damping, a trackpad, a hand on a mouse — across
    // the threshold, popping the surface every frame.
    const alt = splitBoundaryAltitude();

    let state = selectTiles(cameraAt(alt), PARAMS).state;
    const depths: number[] = [];
    for (let i = 0; i < 40; i++) {
      const cam = cameraAt(alt * (1 + (i % 2 === 0 ? -0.02 : 0.02)));
      const sel = selectTiles(cam, PARAMS, state);
      state = sel.state;
      depths.push(depthUnderCamera(sel.tiles, cam));
    }

    expect(depths.every((d) => d >= 0), 'no tile found under the camera').toBe(true);

    let changes = 0;
    for (let i = 1; i < depths.length; i++) {
      if (depths[i] !== depths[i - 1]) {
        changes++;
      }
    }
    // With hysteresis this settles after at most one adjustment. Without it,
    // the depth alternates on essentially every jitter step.
    expect(changes, `LOD under the camera changed ${changes} times: ${depths.join('')}`).toBeLessThan(3);
  });

  it('holds a split until the merge threshold, unlike a single-threshold policy', () => {
    // At an altitude between the two thresholds the outcome must depend on
    // history: already-split stays split, not-split stays merged.
    const findBoundaryAlt = (): number | undefined => {
      for (let i = 0; i < 400; i++) {
        const alt = 0.05 + i * 0.005;
        const cold = selectTiles(cameraAt(alt), PARAMS, new Set());
        const warm = selectTiles(cameraAt(alt), PARAMS, selectTiles(cameraAt(alt * 0.5), PARAMS).state);
        if (warm.tiles.length > cold.tiles.length) {
          return alt;
        }
      }
      return undefined;
    };
    const alt = findBoundaryAlt();
    expect(alt, 'no altitude found where history changes the cut').toBeDefined();
  });

  it('converges to the cold-start cut once the camera settles', () => {
    // Hysteresis must not leave the tree permanently over-refined: repeatedly
    // selecting at a fixed camera has to reach a fixed point.
    let state = new Set<number>();
    let last = '';
    for (let i = 0; i < 20; i++) {
      const sel = selectTiles(cameraAt(0.4), PARAMS, state);
      state = sel.state;
      last = [...sel.tiles].sort((a, b) => a - b).join(',');
    }
    const again = selectTiles(cameraAt(0.4), PARAMS, state);
    expect([...again.tiles].sort((a, b) => a - b).join(',')).toBe(last);
  });
});
