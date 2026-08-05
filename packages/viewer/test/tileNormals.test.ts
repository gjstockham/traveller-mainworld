/**
 * WP12: the normals, and the seam they must not make.
 *
 * The apron exists for one property — that a normal at a tile's edge vertex
 * comes out the same whichever tile computed it — and everything else in this
 * file is there to stop that property being satisfied trivially. A function
 * returning the radial direction at every vertex would pass a naive seam test
 * perfectly, so the seam assertions are paired with checks that the normals
 * *vary*, that they respond to the ring, and that they do not respond to
 * anything else.
 *
 * The seam is asserted **exactly**, per the repo's standing rule: a guarantee
 * checked with a tolerance is a guarantee about the tolerance.
 */
import {
  GEN_VERSION,
  TsTileGenerator,
  type World,
  allocateTileOutput,
  apronIndex,
  interpretText,
  makeTileId,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { vertexCount } from '../src/mesh/tileMesh.js';
import { allocateNormalScratch, buildTileNormals } from '../src/mesh/tileNormals.js';

const WORLD: World = {
  spec: interpretText('X400000-0'),
  seedHi: 0x0badf00d,
  seedLo: 0xcafebabe,
};

/**
 * True scale, the shipped default: one scene unit per planetary radius.
 *
 * It matters which scale these run at. The cross-face residual below is a
 * relief effect, so it grows with exaggeration — at 10 000× it reaches 170°,
 * which says nothing about the viewer and everything about the multiplier.
 */
const SCALE = 1 / (WORLD.spec.radiusKm * 1000);

const generator = new TsTileGenerator(GEN_VERSION);

interface Built {
  readonly normals: Float32Array;
  readonly directions: Float64Array;
}

/**
 * Generate a tile and its normals.
 *
 * @param mangle Optional edit to the apron before the normals are taken —
 *               how the mutation checks below reach inside.
 */
function build(tileId: number, n: number, mangle?: (apron: Float64Array) => void): Built {
  const out = allocateTileOutput(n);
  const tile = generator.generate(tileId, WORLD, n, out);
  const apron = Float64Array.from(tile.apronElevation);
  mangle?.(apron);

  const normals = new Float32Array(vertexCount(n) * 3);
  buildTileNormals(
    tileId,
    apron,
    { n, radius: 1, elevationScale: SCALE },
    allocateNormalScratch(n),
    normals,
  );
  return { normals, directions: Float64Array.from(tile.directions) };
}

const grid = (n: number, i: number, j: number): number => (j * (n + 1) + i) * 3;

/** Angle between two unit vectors, in degrees. */
function angleBetween(a: Float32Array, ia: number, b: Float32Array, ib: number): number {
  const dot = a[ia]! * b[ib]! + a[ia + 1]! * b[ib + 1]! + a[ia + 2]! * b[ib + 2]!;
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

/** Descend the quadtree hugging one side, so the tile's edge is the face's edge. */
function hugging(depth: number, right: boolean): number {
  let path = 0;
  for (let k = 0; k < depth; k++) {
    path = path * 4 + (right ? 1 : 0);
  }
  return path;
}

describe('normals are normals', () => {
  it('is a unit vector at every vertex, skirts included', () => {
    const n = 16;
    const { normals } = build(makeTileId(2, 3, 0b101101), n);
    let worst = 0;
    for (let v = 0; v < vertexCount(n); v++) {
      const length = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!);
      worst = Math.max(worst, Math.abs(length - 1));
    }
    // Float32 storage of a Float64-normalised vector; nothing looser is
    // expected and nothing looser should be accepted.
    expect(worst).toBeLessThan(1e-6);
  });

  it('points outward on all six faces', () => {
    // The cross-product order is the face convention, and the convention is
    // uniform across faces by design (`tileMesh.ts`). Checked against the
    // outward direction rather than derived, which is what `buildTileIndices`
    // does about winding for the same reason.
    const n = 8;
    for (let face = 0; face < 6; face++) {
      const { normals, directions } = build(makeTileId(face, 2, 0b0110), n);
      let minDot = 1;
      for (let v = 0; v < (n + 1) * (n + 1); v++) {
        minDot = Math.min(
          minDot,
          normals[v * 3]! * directions[v * 3]! +
            normals[v * 3 + 1]! * directions[v * 3 + 1]! +
            normals[v * 3 + 2]! * directions[v * 3 + 2]!,
        );
      }
      // A terrain normal on a real world leans away from radial by degrees, not
      // by a quadrant. Anything near zero would mean an inverted face.
      expect(minDot, `face ${String(face)}`).toBeGreaterThan(0.9);
    }
  });

  it('actually varies, so the seam checks below are not about a constant', () => {
    // The failure mode that would make every other test in this file green for
    // nothing: return the radial direction everywhere and every seam matches.
    const n = 16;
    const { normals, directions } = build(makeTileId(4, 4, 0b10011011), n);
    let maxDeviation = 0;
    for (let v = 0; v < (n + 1) * (n + 1); v++) {
      const dot =
        normals[v * 3]! * directions[v * 3]! +
        normals[v * 3 + 1]! * directions[v * 3 + 1]! +
        normals[v * 3 + 2]! * directions[v * 3 + 2]!;
      maxDeviation = Math.max(maxDeviation, (Math.acos(Math.min(1, dot)) * 180) / Math.PI);
    }
    expect(maxDeviation).toBeGreaterThan(1);
  });

  it('gives skirt vertices their edge vertex normal exactly', () => {
    // Not a tidiness point. The wall is near-radial, so its geometric normal
    // points sideways and it renders almost black — the dark hairline the
    // README describes at every unnecessary tile join. Copying the surface
    // normal is what makes a sliver read as terrain instead.
    const n = 8;
    const { normals } = build(makeTileId(0, 2, 0b0011), n);
    const gridVerts = (n + 1) * (n + 1);
    const skirtTop = (e: number, k: number): number => gridVerts + e * (n + 1) + k;
    const skirtBottom = (e: number, k: number): number => gridVerts + 4 * (n + 1) + e * (n + 1) + k;

    const edges: [number, (k: number) => number][] = [
      [0, (k) => grid(n, k, 0)],
      [1, (k) => grid(n, k, n)],
      [2, (k) => grid(n, 0, k)],
      [3, (k) => grid(n, n, k)],
    ];

    const mismatches: string[] = [];
    for (const [e, source] of edges) {
      for (let k = 0; k <= n; k++) {
        const from = source(k);
        for (const s of [skirtTop(e, k), skirtBottom(e, k)]) {
          for (let c = 0; c < 3; c++) {
            if (normals[s * 3 + c] !== normals[from + c]) {
              mismatches.push(`edge ${String(e)} k=${String(k)} component ${String(c)}`);
            }
          }
        }
      }
    }
    // Collected and asserted once: assertion count is a real cost, and 4·(n+1)·2·3
    // individual expectations buy nothing over one list.
    expect(mismatches).toEqual([]);
  });
});

describe('the seam guarantee within a cube face', () => {
  /**
   * Two same-depth neighbours and the vertices they share.
   *
   * Depth 1 on face 0: quad 0 covers `u ∈ [0, ½]`, quad 1 covers `[½, 1]` at the
   * same `v`, so they meet along a whole tile edge. Quad 2 is the vertical
   * neighbour of quad 0 by the same argument on `v`.
   */
  // 9², 65² and 129². The last is there because the golden fixtures hash at 129²
  // while the viewer meshes at 65² (Phase 1 open question 1), so a guarantee
  // demonstrated at only one of them is a guarantee about half the shipped path.
  for (const n of [8, 64, 128]) {
    it(`is exact along a shared column at n=${String(n)}`, () => {
      const left = build(makeTileId(0, 1, 0), n);
      const right = build(makeTileId(0, 1, 1), n);

      const mismatches: string[] = [];
      let spread = 0;
      for (let j = 0; j <= n; j++) {
        const a = grid(n, n, j);
        const b = grid(n, 0, j);
        for (let c = 0; c < 3; c++) {
          if (left.normals[a + c] !== right.normals[b + c]) {
            mismatches.push(`row ${String(j)} component ${String(c)}`);
          }
        }
        spread = Math.max(spread, angleBetween(left.normals, a, left.normals, grid(n, n, 0)));
      }

      expect(mismatches).toEqual([]);
      // ...and the shared edge is not a flat line of identical normals, which
      // would make the equality above true for the wrong reason.
      expect(spread).toBeGreaterThan(1);
    });

    it(`is exact along a shared row at n=${String(n)}`, () => {
      const bottom = build(makeTileId(0, 1, 0), n);
      const top = build(makeTileId(0, 1, 2), n);

      const mismatches: string[] = [];
      for (let i = 0; i <= n; i++) {
        const a = grid(n, i, n);
        const b = grid(n, i, 0);
        for (let c = 0; c < 3; c++) {
          if (bottom.normals[a + c] !== top.normals[b + c]) {
            mismatches.push(`column ${String(i)} component ${String(c)}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it('is exact at the corner where four tiles meet', () => {
    // The corner is the vertex with the most ways to disagree: it is on a
    // shared column for one pair and a shared row for another, and its four
    // neighbours in the difference stencil come from three different tiles.
    const n = 16;
    const quads = [0, 1, 2, 3].map((q) => build(makeTileId(0, 1, q), n));
    const corners = [grid(n, n, n), grid(n, 0, n), grid(n, n, 0), grid(n, 0, 0)];

    const first = quads[0]!.normals;
    const mismatches: string[] = [];
    for (let q = 1; q < 4; q++) {
      for (let c = 0; c < 3; c++) {
        if (quads[q]!.normals[corners[q]! + c] !== first[corners[0]! + c]) {
          mismatches.push(`quad ${String(q)} component ${String(c)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('the apron is what makes it exact', () => {
  /** Replace the ring with the nearest interior value — "no apron", in effect. */
  function clampRing(n: number): (apron: Float64Array) => void {
    return (apron) => {
      for (let j = -1; j <= n + 1; j++) {
        for (let i = -1; i <= n + 1; i++) {
          if (i >= 0 && i <= n && j >= 0 && j <= n) continue;
          apron[apronIndex(n, i, j)] =
            apron[apronIndex(n, Math.max(0, Math.min(n, i)), Math.max(0, Math.min(n, j)))]!;
        }
      }
    };
  }

  it('moves edge normals and leaves interior normals untouched', () => {
    // The load-bearing mutation. If `buildTileNormals` quietly ignored the ring
    // — read the interior twice, fall back to radial at the border — every seam
    // assertion above would still pass, because both tiles would ignore it
    // identically. This is what says the ring is read, and read only where it
    // should be.
    const n = 16;
    const tileId = makeTileId(0, 3, 0b101010);
    const real = build(tileId, n);
    const starved = build(tileId, n, clampRing(n));

    let movedOnEdge = 0;
    for (let j = 0; j <= n; j++) {
      movedOnEdge = Math.max(movedOnEdge, angleBetween(real.normals, grid(n, 0, j), starved.normals, grid(n, 0, j)));
      movedOnEdge = Math.max(movedOnEdge, angleBetween(real.normals, grid(n, n, j), starved.normals, grid(n, n, j)));
    }
    expect(movedOnEdge).toBeGreaterThan(0.5);

    const interior: string[] = [];
    for (let j = 1; j < n; j++) {
      for (let i = 1; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          if (real.normals[grid(n, i, j) + c] !== starved.normals[grid(n, i, j) + c]) {
            interior.push(`(${String(i)}, ${String(j)})`);
          }
        }
      }
    }
    expect(interior).toEqual([]);
  });

  it('breaks the seam when the ring is thrown away', () => {
    // The other half: the same two neighbours that agree exactly above now
    // disagree. Without this, "the seam is exact" could be a property of the
    // terrain rather than of the apron.
    const n = 64;
    const left = build(makeTileId(0, 1, 0), n, clampRing(n));
    const right = build(makeTileId(0, 1, 1), n, clampRing(n));

    let worst = 0;
    for (let j = 0; j <= n; j++) {
      worst = Math.max(worst, angleBetween(left.normals, grid(n, n, j), right.normals, grid(n, 0, j)));
    }
    expect(worst).toBeGreaterThan(1);
  });
});

describe('across a cube-face boundary, where it is an extrapolation', () => {
  /**
   * Face 0's `u = 1` edge is face 5's `u = 0` edge, at the same `v`.
   *
   * From `faceVector`: face 0 is `(1, −t, −s)` and face 5 is `(−s, −t, −1)`, so
   * face 0 at `s = 1` and face 5 at `s = −1` are the same points on the cube.
   * The test asserts that rather than assuming it — if the mapping ever
   * changes, this stops silently comparing unrelated vertices.
   */
  const n = 64;

  it('shares its vertices exactly, and its normals only approximately', () => {
    const measurements: { depth: number; mean: number; max: number }[] = [];

    for (const depth of [1, 3, 5]) {
      const a = build(makeTileId(0, depth, hugging(depth, true)), n);
      const b = build(makeTileId(5, depth, hugging(depth, false)), n);

      const unshared: string[] = [];
      const angles: number[] = [];
      for (let j = 0; j <= n; j++) {
        const p = grid(n, n, j);
        const q = grid(n, 0, j);
        const separation =
          Math.abs(a.directions[p]! - b.directions[q]!) +
          Math.abs(a.directions[p + 1]! - b.directions[q + 1]!) +
          Math.abs(a.directions[p + 2]! - b.directions[q + 2]!);
        if (separation > 1e-12) {
          unshared.push(`row ${String(j)}`);
          continue;
        }
        angles.push(angleBetween(a.normals, p, b.normals, q));
      }

      // The vertices are shared: `tanWarp(±1)` is exactly ±1, which is the
      // cube-sphere seam property `cubesphere.test.ts` pins.
      expect(unshared, `depth ${String(depth)}`).toEqual([]);
      expect(angles).toHaveLength(n + 1);

      measurements.push({
        depth,
        mean: angles.reduce((x, y) => x + y, 0) / angles.length,
        max: Math.max(...angles),
      });
    }

    // **This is the residual, stated as a number rather than a shrug.**
    //
    // Across the twelve cube edges the apron ring continues face A's own
    // parameterisation past `u = 1` instead of crossing onto face B, so the two
    // tiles take their difference over slightly different steps. Measured on
    // `X400000-0` at true scale: mean 0.6-2.0deg and max 2.6-11.1deg over depths
    // 1, 3 and 5, rising with depth as finer crater bands steepen the local
    // slope. On a sphere with the relief switched off it is under 0.03deg, which
    // is what identifies it as a relief effect and not a geometry bug.
    //
    // For scale, the artefact the apron removes — a one-sided difference at
    // *every* tile edge — measures mean 0.9-2.3deg and max 6.0-15.9deg at the
    // same depths. So this is not "nearly as bad everywhere"; it is the same
    // size of step confined to twelve edges instead of the whole quadtree.
    //
    // The fix is the cross-face rotation table the skirts already want for
    // exactly these twelve edges, and it belongs in `tilegen.ts` where the ring
    // is generated. That is a work package, not a constant.
    for (const { depth, mean, max } of measurements) {
      expect(mean, `mean at depth ${String(depth)}`).toBeLessThan(5);
      expect(max, `max at depth ${String(depth)}`).toBeLessThan(20);
    }
    // And it is genuinely non-zero, which is the honest half: asserting only an
    // upper bound would let a future exact fix pass unnoticed as "still fine".
    expect(Math.max(...measurements.map((m) => m.max))).toBeGreaterThan(0);
  });
});

describe('buffer guards', () => {
  it('refuses an output that is too small rather than writing past it', () => {
    const n = 8;
    const apron = new Float64Array((n + 3) * (n + 3));
    expect(() =>
      buildTileNormals(
        makeTileId(0, 0, 0),
        apron,
        { n, radius: 1, elevationScale: SCALE },
        allocateNormalScratch(n),
        new Float32Array(3),
      ),
    ).toThrow(/normals buffer holds/);
  });

  it('refuses scratch or an apron sized for a different n', () => {
    const n = 8;
    expect(() =>
      buildTileNormals(
        makeTileId(0, 0, 0),
        new Float64Array((n + 3) * (n + 3)),
        { n, radius: 1, elevationScale: SCALE },
        allocateNormalScratch(4),
        new Float32Array(vertexCount(n) * 3),
      ),
    ).toThrow(/normal scratch holds/);

    expect(() =>
      buildTileNormals(
        makeTileId(0, 0, 0),
        new Float64Array(4),
        { n, radius: 1, elevationScale: SCALE },
        allocateNormalScratch(n),
        new Float32Array(vertexCount(n) * 3),
      ),
    ).toThrow(/apron holds/);
  });
});
