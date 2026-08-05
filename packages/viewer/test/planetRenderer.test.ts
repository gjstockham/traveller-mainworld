import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { MESH_PROBE_COLOUR, PlanetRenderer } from '../src/render/planet.js';
import { vertexCount } from '../src/mesh/tileMesh.js';

/**
 * These cover mesh *construction* only — no WebGL context is created, and
 * nothing here says anything about what appears on screen.
 *
 * The probe is worth a test for one reason: it is a diagnostic whose whole value
 * is the colour of a buffer nobody has written to. If `initialColour` silently
 * failed to apply, the probe would report "still black" and would send the
 * black-flicker investigation (docs/evidence/spikec-exit.md) down hypothesis 1
 * on no evidence at all. A check that cannot fail is worse here than no check.
 */
const N = 4;

function colourOf(planet: PlanetRenderer, tileId: number): Float32Array {
  const mesh = planet.group.children[0] as THREE.Mesh | undefined;
  if (mesh === undefined) {
    throw new Error(`no mesh in the group for tile ${String(tileId)}`);
  }
  return (mesh.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
}

/** A tile whose colours are all zero, so only the initial fill can be non-zero. */
function blankTile(tileId: number): {
  tileId: number;
  n: number;
  positions: Float32Array;
  colours: Float32Array;
  minElevation: number;
  maxElevation: number;
} {
  const verts = vertexCount(N);
  return {
    tileId,
    n: N,
    positions: new Float32Array(verts * 3),
    colours: new Float32Array(verts * 3),
    minElevation: 0,
    maxElevation: 0,
  };
}

describe('the mesh probe', () => {
  it('fills a new mesh with magenta before any tile data is written', () => {
    const planet = new PlanetRenderer({ n: N, initialColour: MESH_PROBE_COLOUR });
    // Reach the freshly-created mesh without going through upsert, which would
    // immediately overwrite the very thing under test.
    const mesh = planet['createMesh']();
    const colours = (mesh.geometry.getAttribute('color') as THREE.BufferAttribute)
      .array as Float32Array;

    expect(colours.length).toBe(vertexCount(N) * 3);
    for (let v = 0; v < vertexCount(N); v++) {
      expect([colours[v * 3], colours[v * 3 + 1], colours[v * 3 + 2]]).toEqual([
        MESH_PROBE_COLOUR[0],
        MESH_PROBE_COLOUR[1],
        MESH_PROBE_COLOUR[2],
      ]);
    }
    planet.dispose();
  });

  it('leaves the buffer black when the probe is off', () => {
    // The default has to stay black, or the probe would prove nothing: a page
    // that is always magenta cannot distinguish an unwritten buffer.
    const planet = new PlanetRenderer({ n: N });
    const mesh = planet['createMesh']();
    const colours = (mesh.geometry.getAttribute('color') as THREE.BufferAttribute)
      .array as Float32Array;
    expect(colours.every((c) => c === 0)).toBe(true);
    planet.dispose();
  });

  it('is overwritten by real tile colours, so it only ever shows unwritten vertices', () => {
    const planet = new PlanetRenderer({ n: N, initialColour: MESH_PROBE_COLOUR });
    const tile = blankTile(1);
    planet.upsert(tile);
    expect(colourOf(planet, 1).every((c) => c === 0)).toBe(true);
    planet.dispose();
  });
});
