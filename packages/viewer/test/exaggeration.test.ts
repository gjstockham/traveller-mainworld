import { FIXTURES, type PhysicalWorldSpec, interpretText } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXAGGERATION,
  MAX_EXAGGERATION,
  displayedReliefFraction,
  elevationScaleFor,
  exaggerationFrom,
  reliefRatio,
} from '../src/render/exaggeration.js';

// Only radius and relief matter to exaggeration; the rest of the spec comes
// from an airless Size 8 UPP so this file holds no rules knowledge of its own.
const spec = (radiusKm: number, terrainAmplitudeM: number): PhysicalWorldSpec => ({
  ...interpretText('X800000-0'),
  radiusKm,
  terrainAmplitudeM,
  fbm: { octaves: 8, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
});

const q = (search: string): URLSearchParams => new URLSearchParams(search);

describe('display exaggeration', () => {
  it('defaults to true scale', () => {
    // A photograph of a planet has no vertical exaggeration. Anything above 1
    // makes a large world look rockier than it is.
    expect(DEFAULT_EXAGGERATION).toBe(1);
    const earth = spec(6400, 20_000);
    expect(displayedReliefFraction(earth)).toBe(reliefRatio(earth));
  });

  it('leaves every fixture geometrically a sphere', () => {
    // Earth departs from a circle by 0.31% of its radius and photographs as a
    // perfect disc. At true scale ours do too. The previous settings put Size 1
    // at 90%, then 23.7%, then 8.3% - all of them visibly not a circle.
    for (const f of FIXTURES) {
      expect(displayedReliefFraction(f.world.spec), f.id).toBeLessThan(0.02);
    }
  });

  it('converts metres to scene units where the radius is 1', () => {
    const s = spec(6400, 20_000);
    expect(elevationScaleFor(s) * 20_000).toBeCloseTo(displayedReliefFraction(s), 12);
    // 20 km on a 6400 km radius really is 0.3125% of it.
    expect(displayedReliefFraction(s)).toBeCloseTo(0.003125, 9);
  });

  it('scales linearly with the override', () => {
    const s = spec(6400, 20_000);
    expect(elevationScaleFor(s, 10)).toBeCloseTo(elevationScaleFor(s, 1) * 10, 12);
    expect(displayedReliefFraction(s, 30)).toBeCloseTo(reliefRatio(s) * 30, 12);
  });

  it('reads the override off the query string', () => {
    expect(exaggerationFrom(q(''))).toBe(DEFAULT_EXAGGERATION);
    expect(exaggerationFrom(q('?exaggeration=12'))).toBe(12);
    expect(exaggerationFrom(q('?exaggeration=0.5'))).toBe(0.5);
  });

  it('refuses a nonsense override rather than ignoring it', () => {
    // Silently falling back is how someone concludes the terrain is flat when
    // they simply mistyped.
    expect(() => exaggerationFrom(q('?exaggeration=abc'))).toThrow(/positive number/);
    expect(() => exaggerationFrom(q('?exaggeration=0'))).toThrow(/positive number/);
    expect(() => exaggerationFrom(q('?exaggeration=-3'))).toThrow(/positive number/);
    expect(() => exaggerationFrom(q(`?exaggeration=${String(MAX_EXAGGERATION + 1)}`))).toThrow(
      /exceeds/,
    );
  });

  it('degrades to zero rather than dividing by it', () => {
    expect(elevationScaleFor(spec(0, 10_000))).toBe(0);
    expect(Number.isFinite(elevationScaleFor(spec(-1, 10_000)))).toBe(true);
  });
});
