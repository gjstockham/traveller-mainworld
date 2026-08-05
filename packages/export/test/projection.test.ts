import { BAND_GATE_N, MAX_DEPTH, referenceSpacing } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { detailDepthFor, requireDepth } from '../src/detailDepth.js';
import { DEG, HALF_PI, directionFromGeographic } from '../src/geography.js';
import {
  WEB_MERCATOR_CLIP_DEG,
  equirectangular,
  mercator,
  mercatorLatitude,
  mercatorY,
  projectionIds,
  requireProjection,
} from '../src/projection/index.js';
import type { ImageSize } from '../src/size.js';
import { formatSize, parseSize } from '../src/size.js';

const geo = new Float64Array(2);
const dir = new Float64Array(3);
const box = new Float64Array(6);

const SIZE: ImageSize = { width: 4096, height: 2048 };
const SMALL: ImageSize = { width: 64, height: 32 };

describe('the registry', () => {
  it('builds both MVP projections and refuses an unknown id by name', () => {
    expect(projectionIds()).toEqual(['equirectangular', 'mercator']);
    for (const id of projectionIds()) {
      expect(requireProjection(id).id).toBe(id);
    }
    expect(() => requireProjection('winkel')).toThrow(/unknown projection 'winkel'.*equirectangular, mercator/s);
  });

  it("carries Mercator's clip as a parameter rather than a constant", () => {
    expect(requireProjection('mercator', { clipDeg: 70 }).parameterLines().join()).toMatch(/70\.0000/);
    expect(requireProjection('mercator').parameterLines().join()).toMatch(/Web Mercator convention/);
    expect(() => requireProjection('mercator', { clipDeg: 89.99 })).toThrow(/outside/);
    expect(() => requireProjection('mercator', { clipDeg: 0 })).toThrow(/outside/);
  });
});

describe('equirectangular samples pixel centres, so no row is at a pole', () => {
  const projection = equirectangular();

  // The plan's warning is about grid registration: a row *at* the pole, where
  // the direction is a limit and the longitude term vanishes. Area registration
  // makes that unreachable rather than special-cased, and this is the assertion
  // that says so — not "the top row is one colour", which is not true of this
  // design and would be a claim about a map that had lost half a row of latitude
  // at each end.
  it('never asks for +/-90 degrees, at any height', () => {
    for (const height of [2, 3, 16, 1024, 2048, 4095]) {
      const size = { width: 8, height };
      for (const py of [0, height - 1]) {
        projection.pixelToGeographic(size, 0, py, geo);
        expect(Math.abs(geo[0]!)).toBeLessThan(HALF_PI);
        expect(Math.cos(geo[0]!)).toBeGreaterThan(0);
      }
    }
  });

  it('puts the poles on the outer edges of the first and last rows', () => {
    // The map covers exactly 180 degrees of latitude, which is what makes it a
    // correct equirectangular raster rather than one short by a row.
    const top = HALF_PI - (0 / SIZE.height) * Math.PI;
    const bottom = HALF_PI - (SIZE.height / SIZE.height) * Math.PI;
    expect(top).toBe(HALF_PI);
    expect(bottom).toBe(-HALF_PI);

    projection.pixelToGeographic(SIZE, 0, 0, geo);
    expect(geo[0]! / DEG).toBeCloseTo(90 - 90 / SIZE.height, 9);
  });

  it('is continuous across the top row: no seam where a pole would have been', () => {
    // The real property. The top row's samples lie on a circle of radius
    // cos(89.956 deg) = 7.7e-4, so consecutive pixels are ~1e-6 apart on the
    // unit sphere — three orders of magnitude closer than an equatorial pair.
    // A polar row is heavily oversampled, not discontinuous.
    const worstAt = (py: number): number => {
      let worst = 0;
      let prev: [number, number, number] | undefined;
      for (let px = 0; px < SIZE.width; px += 7) {
        projection.pixelToGeographic(SIZE, px, py, geo);
        directionFromGeographic(geo[0]!, geo[1]!, dir);
        const here: [number, number, number] = [dir[0]!, dir[1]!, dir[2]!];
        if (prev !== undefined) {
          const dx = here[0] - prev[0];
          const dy = here[1] - prev[1];
          const dz = here[2] - prev[2];
          worst = Math.max(worst, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        prev = here;
      }
      return worst;
    };

    const polar = worstAt(0);
    const equator = worstAt(SIZE.height / 2);
    expect(polar).toBeLessThan(equator);
    expect(polar).toBeLessThan(equator / 100);
  });

  it('wraps in longitude: column 0 and column W-1 are one step apart, not two', () => {
    projection.pixelToGeographic(SIZE, 0, 1000, geo);
    const first = geo[1]!;
    projection.pixelToGeographic(SIZE, SIZE.width - 1, 1000, geo);
    const last = geo[1]!;
    const step = (2 * Math.PI) / SIZE.width;
    // Going east off the right edge lands on the left edge one step later.
    expect(last + step - (first + 2 * Math.PI)).toBeCloseTo(0, 12);
  });

  it('covers every pixel: nothing is outside the projected world', () => {
    for (let py = 0; py < SMALL.height; py++) {
      for (let px = 0; px < SMALL.width; px++) {
        expect(projection.pixelToGeographic(SMALL, px, py, geo)).toBe(true);
      }
    }
  });
});

describe('mercator', () => {
  const projection = mercator();

  it('inverts its own forward map', () => {
    for (let latDeg = -85; latDeg <= 85; latDeg += 2.5) {
      expect(mercatorLatitude(mercatorY(latDeg * DEG)) / DEG).toBeCloseTo(latDeg, 10);
    }
  });

  it('reaches y = +/-pi at the Web Mercator clip, which is what makes the world square', () => {
    expect(mercatorY(WEB_MERCATOR_CLIP_DEG * DEG)).toBeCloseTo(Math.PI, 10);
  });

  it('keeps every row strictly inside the clip', () => {
    for (const size of [SMALL, { width: 512, height: 512 }, SIZE]) {
      for (const py of [0, 1, size.height - 2, size.height - 1]) {
        expect(projection.pixelToGeographic(size, 0, py, geo)).toBe(true);
        expect(Math.abs(geo[0]! / DEG)).toBeLessThan(WEB_MERCATOR_CLIP_DEG);
      }
    }
  });

  it('reports a row outside the image as outside the projected world', () => {
    expect(projection.pixelToGeographic(SMALL, 0, SMALL.height + 4, geo)).toBe(false);
    expect(projection.pixelToGeographic(SMALL, 0, -6, geo)).toBe(false);
  });

  it('says on the map where it clipped, and that the poles are missing', () => {
    const lines = mercator(70).parameterLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toMatch(/70\.0000 deg/);
    expect(lines[0]!).toMatch(/poles are not on this map/);
    expect(lines[0]!).toMatch(/non-default/);
  });

  it('moves the visible latitude range when the clip moves', () => {
    // The parameter has to do something. A clip that changed only the caption
    // would be exactly the kind of test-that-tests-nothing this repo keeps
    // finding, so the assertion is on the geography and not on the string.
    mercator(60).pixelToGeographic(SMALL, 0, 0, geo);
    const tight = geo[0]! / DEG;
    mercator(85).pixelToGeographic(SMALL, 0, 0, geo);
    const wide = geo[0]! / DEG;
    expect(tight).toBeLessThan(wide);
    expect(tight).toBeLessThan(60);
    expect(wide).toBeGreaterThan(70);
  });
});

describe('row band bounds', () => {
  // Every direction a band produces must be inside the box the band reports,
  // for both projections. A tight box would silently drop basins from the
  // export and from nothing else.
  it.each([
    ['equirectangular', equirectangular()],
    ['mercator', mercator()],
  ])('%s: contains every direction in every band', (_name, projection) => {
    const size = { width: 32, height: 64 };
    for (let row0 = 0; row0 < size.height; row0 += 8) {
      const rows = Math.min(8, size.height - row0);
      projection.rowBandBounds(size, row0, rows, box);
      for (let py = row0; py < row0 + rows; py++) {
        for (let px = 0; px < size.width; px++) {
          if (!projection.pixelToGeographic(size, px, py, geo)) {
            continue;
          }
          directionFromGeographic(geo[0]!, geo[1]!, dir);
          expect(dir[0]!).toBeGreaterThanOrEqual(box[0]!);
          expect(dir[1]!).toBeGreaterThanOrEqual(box[1]!);
          expect(dir[2]!).toBeGreaterThanOrEqual(box[2]!);
          expect(dir[0]!).toBeLessThanOrEqual(box[3]!);
          expect(dir[1]!).toBeLessThanOrEqual(box[4]!);
          expect(dir[2]!).toBeLessThanOrEqual(box[5]!);
        }
      }
    }
  });
});

describe('the detail depth formula', () => {
  // Plan §8 names two values, and they are the check that the formula is the
  // formula the plan meant rather than one that happens to run.
  it('gives depth 4 at 4096x2048 and depth 3 at 2048x1024, as plan §8 says', () => {
    expect(detailDepthFor(equirectangular(), { width: 4096, height: 2048 })).toBe(4);
    expect(detailDepthFor(equirectangular(), { width: 2048, height: 1024 })).toBe(3);
  });

  it('lands exactly on the reference spacing at those sizes, not just near it', () => {
    // `referenceSpacing(4)` and `2π/4096` are the same double — (π/2)/(16·64)
    // against π/2048 — which is why the two reference sizes come out clean
    // rather than one either side of a rounding.
    expect(referenceSpacing(4)).toBe((2 * Math.PI) / 4096);
    expect(referenceSpacing(3)).toBe((2 * Math.PI) / 2048);
  });

  it('is written against BAND_GATE_N, so open question 1 is not baked in', () => {
    // The formula must be `smallest d with referenceSpacing(d) <= texel`, and
    // `referenceSpacing` is the band gate's own function. If someone replaces it
    // with a literal 64 or 65 this goes red — which is the point, because Phase 1
    // open question 1 (65² vs 129²) is still open and moving it must move this.
    expect(BAND_GATE_N).toBeGreaterThan(0);
    for (const width of [256, 512, 1024, 2048, 4096, 8192]) {
      const size = { width, height: width / 2 };
      const depth = detailDepthFor(equirectangular(), size);
      const texel = equirectangular().finestSpacingRad(size);
      expect(referenceSpacing(depth)).toBeLessThanOrEqual(texel);
      if (depth > 0) {
        expect(referenceSpacing(depth - 1)).toBeGreaterThan(texel);
      }
    }
  });

  it('rises by one per doubling of width', () => {
    let previous = detailDepthFor(equirectangular(), { width: 256, height: 128 });
    for (const width of [512, 1024, 2048, 4096, 8192]) {
      const depth = detailDepthFor(equirectangular(), { width, height: width / 2 });
      expect(depth).toBe(previous + 1);
      previous = depth;
    }
  });

  it('reads the height too, so a square equirectangular map is not under-sampled', () => {
    // A 1:1 equirectangular raster has texels twice as tall as wide at the
    // equator, so latitude is the finer axis and the depth follows it.
    const wide = detailDepthFor(equirectangular(), { width: 2048, height: 1024 });
    const square = detailDepthFor(equirectangular(), { width: 2048, height: 2048 });
    expect(square).toBe(wide + 1);
  });

  it("follows Mercator's clip, because the clip changes the vertical scale", () => {
    const size = { width: 1024, height: 1024 };
    const wideClip = detailDepthFor(mercator(85.0511287798066), size);
    const tightClip = detailDepthFor(mercator(30), size);
    expect(tightClip).toBeGreaterThan(wideClip);
  });

  it('refuses an override that is not a depth', () => {
    expect(() => requireDepth(-1)).toThrow(/0\.\.20/);
    expect(() => requireDepth(MAX_DEPTH + 1)).toThrow(/0\.\.20/);
    expect(() => requireDepth(3.5)).toThrow(/not an integer/);
    expect(requireDepth(0)).toBe(0);
    expect(requireDepth(MAX_DEPTH)).toBe(MAX_DEPTH);
  });
});

describe('sizes', () => {
  it('round-trips the two R24 reference sizes', () => {
    for (const text of ['2048x1024', '4096x2048']) {
      expect(formatSize(parseSize(text))).toBe(text);
    }
  });

  it('refuses a size that is not one, naming the spelling it wants', () => {
    expect(() => parseSize('big')).toThrow(/WIDTHxHEIGHT/);
    expect(() => parseSize('4096')).toThrow(/WIDTHxHEIGHT/);
    expect(() => parseSize('0x100')).toThrow(/width 0 is outside/);
    expect(() => parseSize('100x99999')).toThrow(/height 99999 is outside/);
  });
});
