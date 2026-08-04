import { FIXTURES, type PhysicalWorldSpec } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import {
  DISPLAY_RELIEF_AT_REFERENCE,
  REFERENCE_RELIEF_RATIO,
  displayedReliefFraction,
  effectiveExaggeration,
  elevationScaleFor,
  reliefRatio,
} from '../src/render/exaggeration.js';

const spec = (radiusKm: number, terrainAmplitudeM: number): PhysicalWorldSpec => ({
  radiusKm,
  terrainAmplitudeM,
  fbm: { octaves: 8, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
});

describe('display exaggeration', () => {
  it('shows an Earth-like world at the anchor fraction', () => {
    // 20 km on 6400 km is 0.3125% — size8-earthlike, and Earth to two
    // significant figures. Earth's own 6371 km gives 0.314%, which is why the
    // anchor is the round number and not the measurement.
    const earth = spec(6400, 20_000);
    expect(reliefRatio(earth)).toBe(REFERENCE_RELIEF_RATIO);
    // And real Earth is within a hair of it, which is the point of the anchor.
    expect(reliefRatio(spec(6371, 20_000))).toBeCloseTo(REFERENCE_RELIEF_RATIO, 4);
    expect(displayedReliefFraction(earth)).toBeCloseTo(DISPLAY_RELIEF_AT_REFERENCE, 6);
  });

  it('lands an Earth-like world where the old flat multiplier put it', () => {
    // The old 30× on the old 8 km relief gave 3.75% of radius, and that looked
    // like a planet. The new relief is 20 km, so the multiplier is smaller while
    // the displayed result is the same — which is the property that matters.
    const oldLook = (30 * 8_000) / 6_400_000;
    expect(displayedReliefFraction(spec(6400, 20_000))).toBeCloseTo(oldLook, 2);
  });

  it('converts metres to scene units where the radius is 1', () => {
    const s = spec(6400, 20_000);
    expect(elevationScaleFor(s) * 20_000).toBeCloseTo(displayedReliefFraction(s), 9);
  });

  it('keeps every fixture visibly round', () => {
    // The whole point. A body only departs from a sphere below the hydrostatic
    // threshold, ~200-300 km of radius — Size 0, and out of scope. Anything this
    // product renders should read as a planet, so displayed relief has to stay
    // well under the radius. The old flat 30x put Size 1 at 90%.
    for (const f of FIXTURES) {
      const displayed = displayedReliefFraction(f.world.spec);
      // 10% of radius is already a visibly non-circular limb; a first attempt
      // at this sat at 23.7% for Size 1 and was rejected on sight.
      expect(displayed, `${f.id} displayed relief`).toBeLessThan(0.1);
      expect(displayed, `${f.id} displayed relief`).toBeGreaterThan(0.02);
    }
  });

  it('still lets size be read off the surface', () => {
    // Compressing must not flatten. PRD §6.2 wants Size legible — "Size 8+:
    // subdued relief relative to radius" — so a small world must still look
    // rougher than a large one, just not lumpy.
    const smallest = displayedReliefFraction(FIXTURES[0]!.world.spec);
    const largest = displayedReliefFraction(FIXTURES.at(-1)!.world.spec);
    expect(smallest / largest).toBeGreaterThan(2);
    expect(smallest / largest).toBeLessThan(5);
  });

  it('compresses rather than preserving or flattening the spread', () => {
    // The square root is the whole design. A flat multiplier would reproduce
    // the true spread (potatoes); a constant fraction would erase it.
    const ratios = FIXTURES.map((f) => reliefRatio(f.world.spec));
    const trueSpread = Math.max(...ratios) / Math.min(...ratios);
    const displayed = FIXTURES.map((f) => displayedReliefFraction(f.world.spec));
    const shownSpread = Math.max(...displayed) / Math.min(...displayed);
    expect(shownSpread).toBeLessThan(trueSpread);
    expect(shownSpread).toBeGreaterThan(1);
    expect(shownSpread).toBeCloseTo(Math.sqrt(trueSpread), 5);
  });

  it('is monotonic in true relief', () => {
    const a = displayedReliefFraction(spec(3000, 10_000));
    const b = displayedReliefFraction(spec(3000, 20_000));
    expect(b).toBeGreaterThan(a);
  });

  it('degrades to zero rather than dividing by it', () => {
    expect(displayedReliefFraction(spec(3000, 0))).toBe(0);
    expect(elevationScaleFor(spec(3000, 0))).toBe(0);
    expect(effectiveExaggeration(spec(3000, 0))).toBe(0);
    expect(Number.isFinite(elevationScaleFor(spec(3000, -5)))).toBe(true);
  });
});
