import {
  DEFAULT_FBM,
  GEN_VERSION,
  TsTileGenerator,
  type World,
  makeTileId,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import {
  buildTileColours,
  buildTileIndices,
  buildTilePositions,
  skirtDepthFor,
  triangleCount,
  vertexCount,
} from '../src/mesh/tileMesh.js';

const WORLD: World = {
  spec: { radiusKm: 1737, terrainAmplitudeM: 6000, fbm: DEFAULT_FBM },
  seedHi: 0x1234,
  seedLo: 0x5678,
};

const RADIUS = 1;
const ELEV_SCALE = 25 / (WORLD.spec.radiusKm * 1000); // 25x exaggeration
const gen = new TsTileGenerator(GEN_VERSION);

interface BuiltMesh {
  positions: Float32Array;
  indices: Uint32Array;
  gridVerts: number;
}

function build(face: number, n: number, depth = 0, path = 0): BuiltMesh {
  const tile = gen.generate(makeTileId(face, depth, path), WORLD, n);
  const positions = new Float32Array(3 * vertexCount(n));
  buildTilePositions(tile.directions, tile.elevation, {
    n,
    radius: RADIUS,
    elevationScale: ELEV_SCALE,
    skirtDepth: skirtDepthFor(depth, RADIUS, WORLD.spec.terrainAmplitudeM, ELEV_SCALE, n),
  }, positions);
  return { positions, indices: buildTileIndices(n), gridVerts: (n + 1) * (n + 1) };
}

function triangleNormal(
  p: Float32Array,
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const ax = p[a * 3]!;
  const ay = p[a * 3 + 1]!;
  const az = p[a * 3 + 2]!;
  const ux = p[b * 3]! - ax;
  const uy = p[b * 3 + 1]! - ay;
  const uz = p[b * 3 + 2]! - az;
  const vx = p[c * 3]! - ax;
  const vy = p[c * 3 + 1]! - ay;
  const vz = p[c * 3 + 2]! - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

describe('mesh sizing', () => {
  it('counts vertices and triangles consistently', () => {
    for (const n of [2, 4, 16, 64]) {
      expect(vertexCount(n)).toBe((n + 1) * (n + 1) + 8 * (n + 1));
      expect(triangleCount(n)).toBe(2 * n * n + 8 * n);
      expect(buildTileIndices(n).length).toBe(triangleCount(n) * 3);
    }
  });

  it('references only valid vertices', () => {
    const n = 8;
    const indices = buildTileIndices(n);
    const max = vertexCount(n) - 1;
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(max);
    }
  });

  it('uses every vertex it allocates', () => {
    // A vertex allocated but never indexed is dead weight in every tile.
    const n = 8;
    const used = new Set(buildTileIndices(n));
    expect(used.size).toBe(vertexCount(n));
  });
});

describe('winding', () => {
  it('GRID TRIANGLES FACE OUTWARD ON ALL SIX FACES', () => {
    // If this is inverted the planet renders inside-out under front-face
    // culling. The cube-sphere convention has uniform handedness, so one
    // winding works for every face — but that is a derivation, and this is the
    // check.
    const n = 8;
    for (let face = 0; face < 6; face++) {
      const { positions, indices, gridVerts } = build(face, n);
      let inward = 0;
      let checked = 0;
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        // Grid triangles only; skirt walls are handled separately below.
        if (a >= gridVerts || b >= gridVerts || c >= gridVerts) {
          continue;
        }
        const [nx, ny, nz] = triangleNormal(positions, a, b, c);
        // Outward reference: the centroid's own direction from the origin.
        const cx = (positions[a * 3]! + positions[b * 3]! + positions[c * 3]!) / 3;
        const cy = (positions[a * 3 + 1]! + positions[b * 3 + 1]! + positions[c * 3 + 1]!) / 3;
        const cz = (positions[a * 3 + 2]! + positions[b * 3 + 2]! + positions[c * 3 + 2]!) / 3;
        if (nx * cx + ny * cy + nz * cz <= 0) {
          inward++;
        }
        checked++;
      }
      expect(checked, `face ${face} grid triangles`).toBe(2 * n * n);
      expect(inward, `face ${face} has inward-facing grid triangles`).toBe(0);
    }
  });

  it('skirt triangles face away from the tile interior', () => {
    // A skirt is a near-vertical wall, so its normal is roughly tangential
    // rather than radial — it must point away from the tile centre, or the
    // wall is invisible from outside and the crack shows through.
    const n = 8;
    for (let face = 0; face < 6; face++) {
      const { positions, indices, gridVerts } = build(face, n);

      // Tile centre direction.
      const centre = gridVerts === 0 ? 0 : ((n / 2) * (n + 1) + n / 2);
      const mx = positions[centre * 3]!;
      const my = positions[centre * 3 + 1]!;
      const mz = positions[centre * 3 + 2]!;

      let wrong = 0;
      let checked = 0;
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        if (a < gridVerts && b < gridVerts && c < gridVerts) {
          continue;
        }
        const [nx, ny, nz] = triangleNormal(positions, a, b, c);
        const cx = (positions[a * 3]! + positions[b * 3]! + positions[c * 3]!) / 3;
        const cy = (positions[a * 3 + 1]! + positions[b * 3 + 1]! + positions[c * 3 + 1]!) / 3;
        const cz = (positions[a * 3 + 2]! + positions[b * 3 + 2]! + positions[c * 3 + 2]!) / 3;
        // Outward-from-centre direction at this skirt.
        if (nx * (cx - mx) + ny * (cy - my) + nz * (cz - mz) <= 0) {
          wrong++;
        }
        checked++;
      }
      expect(checked, `face ${face} skirt triangles`).toBe(8 * n);
      expect(wrong, `face ${face} has inward-facing skirt triangles`).toBe(0);
    }
  });
});

describe('positions', () => {
  it('places grid vertices at radius + scaled elevation', () => {
    const n = 8;
    const { positions } = build(0, n);
    const gridVerts = (n + 1) * (n + 1);
    for (let v = 0; v < gridVerts; v++) {
      const r = Math.hypot(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
      const maxOffset = WORLD.spec.terrainAmplitudeM * ELEV_SCALE;
      expect(r).toBeGreaterThan(RADIUS - maxOffset * 1.01);
      expect(r).toBeLessThan(RADIUS + maxOffset * 1.01);
    }
  });

  it('places skirt vertices strictly below their edge vertex', () => {
    const n = 8;
    const depth = 3;
    const { positions } = build(2, n, depth, 5);
    const gridVerts = (n + 1) * (n + 1);
    const radiusAt = (v: number): number =>
      Math.hypot(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);

    // Bottom edge skirt mirrors grid row j=0. Both rings must sit below the
    // surface, and the top ring above the bottom.
    for (let i = 0; i <= n; i++) {
      const grid = i;
      const skirtTop = gridVerts + i;
      const skirtBottom = gridVerts + 4 * (n + 1) + i;
      expect(radiusAt(skirtTop), `top ring ${i}`).toBeLessThan(radiusAt(grid));
      expect(radiusAt(skirtBottom), `bottom ring ${i}`).toBeLessThan(radiusAt(skirtTop));
    }
  });

  it('rejects an undersized buffer', () => {
    const tile = gen.generate(makeTileId(0, 0, 0), WORLD, 4);
    expect(() =>
      buildTilePositions(
        tile.directions,
        tile.elevation,
        { n: 4, radius: 1, elevationScale: 1, skirtDepth: 0.1 },
        new Float32Array(3),
      ),
    ).toThrow(/buffer/);
  });
});

describe('skirtDepthFor', () => {
  it('shrinks with depth', () => {
    let prev = Infinity;
    for (let d = 0; d <= 12; d++) {
      const s = skirtDepthFor(d, 1, 6000, ELEV_SCALE, 64);
      expect(s).toBeLessThan(prev);
      expect(s).toBeGreaterThan(0);
      prev = s;
    }
  });

  it('STAYS PROPORTIONATE TO THE TILE at every depth', () => {
    // The regression that mattered: a flat `amplitude * 0.5` terrain term does
    // not shrink with depth, so by depth 8 the skirt was ten times longer than
    // the tile was wide and showed as dark seams across the globe.
    for (let d = 0; d <= 14; d++) {
      const tileEdge = (Math.PI / 2) / Math.pow(2, d);
      const ratio = skirtDepthFor(d, 1, 6000, ELEV_SCALE, 64) / tileEdge;
      expect(ratio, `depth ${d} skirt/tile ratio`).toBeGreaterThan(0.001);
      expect(ratio, `depth ${d} skirt/tile ratio`).toBeLessThan(0.05);
    }
  });

  it('scales down as the grid gets finer', () => {
    // More cells per tile means smaller cracks to hide.
    expect(skirtDepthFor(4, 1, 6000, ELEV_SCALE, 128)).toBeLessThan(
      skirtDepthFor(4, 1, 6000, ELEV_SCALE, 32),
    );
  });
});

describe('colours', () => {
  it('writes a colour for every vertex, in range', () => {
    const n = 8;
    const tile = gen.generate(makeTileId(1, 0, 0), WORLD, n);
    const colours = new Float32Array(3 * vertexCount(n));
    buildTileColours(tile.elevation, tile.materials, WORLD.spec.terrainAmplitudeM, n, colours);
    for (const c of colours) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('gives skirts EXACTLY their edge vertex colour', () => {
    // Skirts were originally darkened to read as shadow. That made every
    // sliver peeking through a tile join into a visible dark line tracing the
    // whole quadtree — the seams were the tint, not the geometry. Matching the
    // edge colour makes an unneeded skirt invisible.
    const n = 4;
    const tile = gen.generate(makeTileId(1, 0, 0), WORLD, n);
    const colours = new Float32Array(3 * vertexCount(n));
    buildTileColours(tile.elevation, tile.materials, WORLD.spec.terrainAmplitudeM, n, colours);
    const gridVerts = (n + 1) * (n + 1);
    for (let i = 0; i <= n; i++) {
      for (const skirt of [gridVerts + i, gridVerts + 4 * (n + 1) + i]) {
        for (let c = 0; c < 3; c++) {
          expect(colours[skirt * 3 + c]!).toBe(colours[i * 3 + c]!);
        }
      }
    }
  });
});
