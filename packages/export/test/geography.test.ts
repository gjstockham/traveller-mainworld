import { faceUvToDirection } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import {
  DEG,
  HALF_PI,
  directionFromGeographic,
  geographicFromDirection,
  latitudeBandBounds,
} from '../src/geography.js';

const dir = new Float64Array(3);
const geo = new Float64Array(2);
const box = new Float64Array(6);

function directionAt(latDeg: number, lonDeg: number): [number, number, number] {
  directionFromGeographic(latDeg * DEG, lonDeg * DEG, dir);
  return [dir[0]!, dir[1]!, dir[2]!];
}

describe('the frame', () => {
  // Not a free choice. `OrbitCamera` and `render/sun.ts` both put `+y` at the
  // north pole and measure azimuth from `+z` toward `+x`, and cube-sphere face
  // 2 is `+y`. A map whose north was `+z` would be a correct map of a rotated
  // planet, which is the worst kind of wrong — and nothing about the picture
  // would look wrong.
  it('puts north at +y, matching the camera, the sun and cube face 2', () => {
    expect(directionAt(90, 0)).toEqual([0, 1, 0]);
    expect(directionAt(-90, 0)).toEqual([0, -1, 0]);

    // Face 2 is +Y in `cubesphere.ts`. Its centre must be the north pole.
    const faceCentre = faceUvToDirection(2, 0.5, 0.5);
    expect(faceCentre.y).toBeCloseTo(1, 12);
  });

  it('measures longitude from +z toward +x, as the camera azimuth does', () => {
    const [x0, , z0] = directionAt(0, 0);
    expect(z0).toBeCloseTo(1, 15);
    expect(x0).toBeCloseTo(0, 15);

    const [x90, , z90] = directionAt(0, 90);
    expect(x90).toBeCloseTo(1, 15);
    expect(z90).toBeCloseTo(0, 15);
  });

  it('produces a unit vector at every latitude and longitude', () => {
    let worst = 0;
    for (let lat = -89; lat <= 89; lat += 1) {
      for (let lon = -180; lon < 180; lon += 7) {
        const [x, y, z] = directionAt(lat, lon);
        worst = Math.max(worst, Math.abs(Math.sqrt(x * x + y * y + z * z) - 1));
      }
    }
    // Two multiplications away from a sin/cos pair, so a couple of ulp.
    expect(worst).toBeLessThan(1e-15);
  });
});

describe('a pole is a value, not a limit', () => {
  // The decision this file exists to pin. `Math.cos(Math.PI / 2)` is 6.12e-17
  // rather than zero, so without the exact snap a row of samples across a pole
  // would come back as a ring of points 6e-17 apart — each hashing into a
  // different lattice cell in the deepest crater bands, and whether that showed
  // as one colour or several would depend on how the arithmetic was arranged.
  it('returns the pole axis exactly, not a value 6e-17 off it', () => {
    expect(directionAt(90, 0)).toEqual([0, 1, 0]);
    // What the unsnapped arithmetic would have given, for scale.
    expect(Math.cos(HALF_PI)).toBeGreaterThan(0);
    expect(Math.cos(HALF_PI)).toBeLessThan(1e-16);
  });

  it('gives the same direction at every longitude, so a pole row is one colour', () => {
    const first = directionAt(90, -180);
    for (let lon = -180; lon < 180; lon += 3) {
      expect(directionAt(90, lon)).toEqual(first);
      expect(directionAt(-90, lon)).toEqual([0, -1, 0]);
    }
  });

  it('clamps beyond a pole rather than mirroring the hemisphere', () => {
    // A projection that produced 91° has a bug, and a flat polar cap is a
    // symptom the caller can see. A mirrored hemisphere is not.
    expect(directionAt(120, 40)).toEqual([0, 1, 0]);
    expect(directionAt(-120, 40)).toEqual([0, -1, 0]);
  });

  it('never returns a NaN, at any latitude including past the poles', () => {
    for (let lat = -200; lat <= 200; lat += 0.5) {
      const [x, y, z] = directionAt(lat, 37);
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
    }
  });
});

describe('geographicFromDirection', () => {
  it('round-trips every direction back to itself', () => {
    let worst = 0;
    for (let lat = -89.5; lat <= 89.5; lat += 3.7) {
      for (let lon = -179; lon < 180; lon += 11) {
        const [x, y, z] = directionAt(lat, lon);
        geographicFromDirection(x, y, z, geo);
        directionFromGeographic(geo[0]!, geo[1]!, dir);
        worst = Math.max(
          worst,
          Math.abs(dir[0]! - x),
          Math.abs(dir[1]! - y),
          Math.abs(dir[2]! - z),
        );
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('reports longitude 0 at a pole rather than a NaN', () => {
    geographicFromDirection(0, 1, 0, geo);
    expect(geo[0]!).toBeCloseTo(HALF_PI, 15);
    expect(geo[1]!).toBe(0);
  });
});

describe('latitudeBandBounds', () => {
  // The box the basin cull is built from. `BasinCull` is documented as a
  // superset filter, so a loose box is safe and a *tight* one is the hazard: a
  // box that excludes a basin able to reach a sample would drop that basin's
  // relief from the export and from nothing else, which is the export failing
  // to match the 3D view in a way no seam test would notice.
  function contains(latDeg: number, lonDeg: number): boolean {
    const [x, y, z] = directionAt(latDeg, lonDeg);
    return (
      x >= box[0]! && y >= box[1]! && z >= box[2]! &&
      x <= box[3]! && y <= box[4]! && z <= box[5]!
    );
  }

  it('contains every direction in the band, at every latitude range', () => {
    const ranges: [number, number][] = [
      [-90, -80], [-45, -30], [-5, 5], [0, 15], [60, 75], [80, 90], [-90, 90],
    ];
    for (const [loDeg, hiDeg] of ranges) {
      latitudeBandBounds(loDeg * DEG, hiDeg * DEG, box);
      for (let lat = loDeg; lat <= hiDeg; lat += (hiDeg - loDeg) / 20) {
        for (let lon = -180; lon < 180; lon += 9) {
          expect(contains(lat, lon)).toBe(true);
        }
      }
    }
  });

  it('is thin for a thin band, which is what makes the cull worth building', () => {
    latitudeBandBounds(60 * DEG, 62 * DEG, box);
    const thickness = box[4]! - box[1]!;
    expect(thickness).toBeLessThan(0.02);
    // And its horizontal extent is the equator-facing edge's cosine, not 1.
    expect(box[3]!).toBeCloseTo(Math.cos(60 * DEG), 12);
  });

  it('opens to the full width when the band straddles the equator', () => {
    // `cos` peaks *inside* the band there, so taking the maximum at the two ends
    // would give 0.996 and clip a strip of the equator out of the cull.
    latitudeBandBounds(-5 * DEG, 5 * DEG, box);
    expect(box[3]!).toBe(1);
    expect(box[0]!).toBe(-1);
  });

  it('accepts its arguments in either order', () => {
    latitudeBandBounds(10 * DEG, 40 * DEG, box);
    const forward = Array.from(box);
    latitudeBandBounds(40 * DEG, 10 * DEG, box);
    expect(Array.from(box)).toEqual(forward);
  });
});
