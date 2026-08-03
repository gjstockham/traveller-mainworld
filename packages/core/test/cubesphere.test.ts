import { describe, expect, it } from 'vitest';

import {
  directionToFaceUv,
  faceUvToDirection,
  tileVertexDirections,
} from '../src/kernel/cubesphere.js';
import {
  FACE_COUNT,
  MAX_DEPTH,
  makeTileId,
  quadPathLimit,
  rootTiles,
  tileBounds,
  tileChild,
  tileDepth,
  tileFace,
  tileParent,
  tileQuadPath,
  tileToString,
} from '../src/kernel/tileid.js';

describe('TileId packing', () => {
  it('round-trips every component', () => {
    for (const [face, depth, path] of [
      [0, 0, 0],
      [5, 1, 3],
      [3, 6, 4095],
      [2, MAX_DEPTH, quadPathLimit(MAX_DEPTH) - 1],
    ]) {
      const id = makeTileId(face!, depth!, path!);
      expect(tileFace(id), 'face').toBe(face);
      expect(tileDepth(id), 'depth').toBe(depth);
      expect(tileQuadPath(id), 'path').toBe(path);
    }
  });

  it('stays inside the exactly-representable integer range at max depth', () => {
    // The whole reason MAX_DEPTH is 20: beyond it the key silently stops being
    // an exact integer and IDs start colliding.
    const id = makeTileId(5, MAX_DEPTH, quadPathLimit(MAX_DEPTH) - 1);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeLessThan(2 ** 53);
  });

  it('produces distinct IDs across a large sweep', () => {
    const seen = new Set<number>();
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let depth = 0; depth <= 8; depth++) {
        const limit = Math.min(quadPathLimit(depth), 512);
        for (let path = 0; path < limit; path++) {
          seen.add(makeTileId(face, depth, path));
        }
      }
    }
    let expected = 0;
    for (let depth = 0; depth <= 8; depth++) {
      expected += Math.min(quadPathLimit(depth), 512);
    }
    expect(seen.size).toBe(expected * FACE_COUNT);
  });

  it('rejects out-of-range addresses rather than corrupting the key', () => {
    expect(() => makeTileId(0, MAX_DEPTH + 1, 0)).toThrow(/depth/);
    expect(() => makeTileId(FACE_COUNT, 0, 0)).toThrow(/face/);
    expect(() => makeTileId(0, 1, 4)).toThrow(/quadPath/);
    expect(() => makeTileId(0, 0, 1)).toThrow(/quadPath/);
  });

  it('navigates parent and child consistently', () => {
    const root = makeTileId(3, 0, 0);
    expect(() => tileParent(root)).toThrow(/root/);
    for (let c = 0; c < 4; c++) {
      const child = tileChild(root, c);
      expect(tileDepth(child)).toBe(1);
      expect(tileParent(child)).toBe(root);
    }
    // Descend a long path and climb back.
    let id = root;
    for (let d = 0; d < MAX_DEPTH; d++) {
      id = tileChild(id, d % 4);
    }
    expect(tileDepth(id)).toBe(MAX_DEPTH);
    expect(() => tileChild(id, 0)).toThrow(/depth/);
    for (let d = 0; d < MAX_DEPTH; d++) {
      id = tileParent(id);
    }
    expect(id).toBe(root);
  });

  it('gives six root tiles, one per face', () => {
    const roots = rootTiles();
    expect(roots.length).toBe(FACE_COUNT);
    expect(new Set(roots.map(tileFace)).size).toBe(FACE_COUNT);
    expect(roots.every((r) => tileDepth(r) === 0)).toBe(true);
  });

  it('formats readably', () => {
    expect(tileToString(makeTileId(4, 0, 0))).toBe('f4/d0/-');
    expect(tileToString(makeTileId(1, 3, 0b011011))).toBe('f1/d3/123');
  });
});

describe('tileBounds', () => {
  it('covers the whole face at depth 0', () => {
    expect(tileBounds(makeTileId(0, 0, 0))).toEqual({ u0: 0, v0: 0, size: 1 });
  });

  it('splits into quadrants with bit 0 = u and bit 1 = v', () => {
    const root = makeTileId(0, 0, 0);
    expect(tileBounds(tileChild(root, 0))).toEqual({ u0: 0, v0: 0, size: 0.5 });
    expect(tileBounds(tileChild(root, 1))).toEqual({ u0: 0.5, v0: 0, size: 0.5 });
    expect(tileBounds(tileChild(root, 2))).toEqual({ u0: 0, v0: 0.5, size: 0.5 });
    expect(tileBounds(tileChild(root, 3))).toEqual({ u0: 0.5, v0: 0.5, size: 0.5 });
  });

  it('children exactly tile their parent, with no gap or overlap', () => {
    let id = makeTileId(2, 0, 0);
    for (let d = 0; d < 10; d++) {
      id = tileChild(id, (d * 7) % 4);
      const p = tileBounds(tileParent(id));
      const c = tileBounds(id);
      expect(c.size * 2).toBe(p.size);
      expect(c.u0).toBeGreaterThanOrEqual(p.u0);
      expect(c.v0).toBeGreaterThanOrEqual(p.v0);
      expect(c.u0 + c.size).toBeLessThanOrEqual(p.u0 + p.size);
      expect(c.v0 + c.size).toBeLessThanOrEqual(p.v0 + p.size);
    }
  });

  it('produces dyadic bounds, so shared edges are exact', () => {
    // Every bound must be k/2^depth exactly; a rounded bound would put
    // neighbouring tiles at fractionally different edge coordinates and tear
    // the terrain along the join.
    for (let depth = 0; depth <= 12; depth++) {
      const scale = 2 ** depth;
      for (let i = 0; i < 50; i++) {
        const path = (i * 7919) % quadPathLimit(depth);
        const b = tileBounds(makeTileId(1, depth, path));
        expect(Number.isInteger(b.u0 * scale), `depth ${depth} u0`).toBe(true);
        expect(Number.isInteger(b.v0 * scale), `depth ${depth} v0`).toBe(true);
        expect(b.size).toBe(1 / scale);
      }
    }
  });
});

describe('faceUvToDirection', () => {
  it('returns unit-length directions', () => {
    let worst = 0;
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let i = 0; i <= 40; i++) {
        for (let j = 0; j <= 40; j++) {
          const d = faceUvToDirection(face, i / 40, j / 40);
          const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
          worst = Math.max(worst, Math.abs(len - 1));
        }
      }
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('puts face centres on the cardinal axes', () => {
    const centres = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (let face = 0; face < FACE_COUNT; face++) {
      const d = faceUvToDirection(face, 0.5, 0.5);
      const [ex, ey, ez] = centres[face]!;
      expect([d.x, d.y, d.z].map((c) => Math.abs(c) < 1e-16 ? 0 : c)).toEqual([ex, ey, ez]);
    }
  });

  it('ADJACENT FACES AGREE EXACTLY ALONG SHARED EDGES', () => {
    // The seam guarantee, and the single most load-bearing property in the
    // geometry module. All generation is a pure function of 3D position, so
    // tiles are seam-free if and only if two faces meeting at an edge compute
    // bit-identical positions for the same physical point.
    //
    // Tested without hard-coding the face adjacency table: gather edge points
    // from all six faces and count exact coordinate coincidences. Every
    // non-corner edge point must be produced by exactly 2 faces, every corner
    // by exactly 3. Any tolerance at all would defeat the purpose, so the key
    // is the exact bit pattern of the coordinates.
    const STEPS = 64; // power of two → dyadic parameters, identical on both faces
    const counts = new Map<string, number>();

    const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

    for (let face = 0; face < FACE_COUNT; face++) {
      for (let k = 0; k <= STEPS; k++) {
        const p = k / STEPS;
        for (const [u, v] of [
          [0, p],
          [1, p],
          [p, 0],
          [p, 1],
        ]) {
          const d = faceUvToDirection(face, u!, v!);
          const s = key(d.x, d.y, d.z);
          counts.set(s, (counts.get(s) ?? 0) + 1);
        }
      }
    }

    const tallies = new Map<number, number>();
    for (const n of counts.values()) {
      tallies.set(n, (tallies.get(n) ?? 0) + 1);
    }

    // Anything appearing once is an edge point that FAILED to match its
    // neighbour — the failure mode this test exists to catch.
    const unmatched = [...counts.entries()].filter(([, n]) => n === 1);
    expect(unmatched.length, `unmatched edge points: ${unmatched.slice(0, 3).map(([s]) => s)}`).toBe(0);

    // 8 cube corners, each shared by 3 faces. Corners are hit twice per face
    // (once from each of the two edges meeting there), hence 6.
    expect(tallies.get(6) ?? 0, 'cube corners').toBe(8);

    // Every remaining distinct point is a non-corner edge point shared by 2.
    const nonCorner = [...counts.values()].filter((n) => n !== 6);
    expect(new Set(nonCorner)).toEqual(new Set([2]));
  });

  it('tangent warp actually evens out the cell spacing', () => {
    // Without the warp, cells near a face centre are ~1.4x smaller than at the
    // corners. Compare the arc covered by the first and middle steps.
    const n = 64;
    const arc = (i: number): number => {
      const a = faceUvToDirection(0, i / n, 0.5);
      const b = faceUvToDirection(0, (i + 1) / n, 0.5);
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    };
    const ratio = arc(0) / arc(n / 2);
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.18);
  });
});

describe('directionToFaceUv', () => {
  it('round-trips faceUvToDirection', () => {
    let worst = 0;
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let i = 1; i < 32; i++) {
        for (let j = 1; j < 32; j++) {
          const u = i / 32;
          const v = j / 32;
          const back = directionToFaceUv(faceUvToDirection(face, u, v));
          expect(back.face, `face ${face} at ${u},${v}`).toBe(face);
          worst = Math.max(worst, Math.abs(back.u - u), Math.abs(back.v - v));
        }
      }
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it('resolves consistently for an arbitrary direction', () => {
    const d = { x: 0.267261241912424, y: 0.534522483824849, z: 0.801783725737273 };
    const a = directionToFaceUv(d);
    const b = directionToFaceUv(d);
    expect(a).toEqual(b);
    expect(a.u).toBeGreaterThanOrEqual(0);
    expect(a.u).toBeLessThanOrEqual(1);
    expect(a.v).toBeGreaterThanOrEqual(0);
    expect(a.v).toBeLessThanOrEqual(1);
  });
});

describe('tileVertexDirections', () => {
  it('fills a (n+1)² grid of unit vectors', () => {
    const n = 8;
    const out = new Float64Array(3 * (n + 1) * (n + 1));
    tileVertexDirections(0, 0, 0, 1, n, out);
    let worst = 0;
    for (let i = 0; i < (n + 1) * (n + 1); i++) {
      const x = out[i * 3]!;
      const y = out[i * 3 + 1]!;
      const z = out[i * 3 + 2]!;
      worst = Math.max(worst, Math.abs(Math.sqrt(x * x + y * y + z * z) - 1));
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('rejects an undersized buffer', () => {
    expect(() => tileVertexDirections(0, 0, 0, 1, 8, new Float64Array(10))).toThrow(/buffer/);
  });

  it('gives a parent and its child bit-identical vertices where they coincide', () => {
    // The LOD-transition guarantee: refining a tile must not move the vertices
    // that already existed, or the surface would pop at every split.
    const n = 8;
    const parent = new Float64Array(3 * (n + 1) * (n + 1));
    const child = new Float64Array(3 * (n + 1) * (n + 1));
    tileVertexDirections(2, 0.25, 0.5, 0.25, n, parent);
    // Lower-left quadrant of the parent, at the same vertex spacing.
    tileVertexDirections(2, 0.25, 0.5, 0.125, n, child);

    let compared = 0;
    for (let j = 0; j <= n / 2; j++) {
      for (let i = 0; i <= n / 2; i++) {
        const pi = (j * (n + 1) + i) * 3;
        const ci = (j * 2 * (n + 1) + i * 2) * 3;
        expect(child[ci]).toBe(parent[pi]);
        expect(child[ci + 1]).toBe(parent[pi + 1]);
        expect(child[ci + 2]).toBe(parent[pi + 2]);
        compared++;
      }
    }
    expect(compared).toBe(25);
  });
});
