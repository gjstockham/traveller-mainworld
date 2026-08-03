import { describe, expect, it } from 'vitest';

import {
  atanCore,
  atanWarpInverse,
  compactFalloff,
  rationalBump,
  tanCore,
  tanWarp,
} from '../src/kernel/approx.js';

/**
 * Note this file sits outside `kernel/`, so `Math.tan` and `Math.atan` are
 * legal here. That is the point: the whole reason `approx.ts` exists is that
 * the platform versions are untrustworthy in the last bits, but they remain a
 * perfectly good *accuracy* reference — it is their cross-engine identity that
 * cannot be relied on, not their correctness.
 */

const PI_OVER_4 = Math.PI / 4;

describe('tanCore', () => {
  it('is within 1 ulp of Math.tan across [-π/4, π/4]', () => {
    let maxRel = 0;
    for (let i = -200_000; i <= 200_000; i++) {
      const x = (i / 200_000) * PI_OVER_4;
      const want = Math.tan(x);
      if (want !== 0) {
        maxRel = Math.max(maxRel, Math.abs((tanCore(x) - want) / want));
      }
    }
    // Measured 2.24e-16 (~1 ulp). The spike plan only asked for 1e-12; the
    // threshold is set near the measured value so a regression is visible.
    expect(maxRel).toBeLessThan(1e-15);
  });

  it('is exact at zero and odd-symmetric', () => {
    expect(tanCore(0)).toBe(0);
    for (const x of [0.1, 0.3, 0.5, PI_OVER_4]) {
      expect(tanCore(-x)).toBe(-tanCore(x));
    }
  });

  it('degrades gracefully to identity for tiny arguments', () => {
    // Below the z < 1e-14 cutoff the correction is sub-ulp.
    expect(tanCore(1e-9)).toBe(1e-9);
    expect(tanCore(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
  });
});

describe('atanCore', () => {
  it('is within 1 ulp of Math.atan across all three range-reduction branches', () => {
    let maxAbs = 0;
    for (let i = -400_000; i <= 400_000; i++) {
      const x = i / 100_000; // spans [-4, 4], crossing tan(π/8) and tan(3π/8)
      maxAbs = Math.max(maxAbs, Math.abs(atanCore(x) - Math.atan(x)));
    }
    expect(maxAbs).toBeLessThan(1e-15);
  });

  it('handles large and extreme arguments', () => {
    for (const x of [5, 100, 1e6, 1e15, 1e300, -3.7, -1e8]) {
      expect(Math.abs(atanCore(x) - Math.atan(x)), `x=${x}`).toBeLessThan(1e-15);
    }
  });

  it('is exact at zero and odd-symmetric', () => {
    expect(atanCore(0)).toBe(0);
    for (const x of [0.2, 0.9, 1, 3, 100]) {
      expect(atanCore(-x)).toBe(-atanCore(x));
    }
  });
});

describe('tanWarp', () => {
  it('is EXACTLY ±1 at the face edges', () => {
    // Load-bearing. Cube face edges sit at u = ±1; if the warp returned
    // 1−1ulp there, adjacent faces would compute different 3D positions for
    // the same edge and the noise field would tear along every seam.
    expect(tanWarp(1)).toBe(1);
    expect(tanWarp(-1)).toBe(-1);
  });

  it('is exactly 0 at the face centre', () => {
    expect(tanWarp(0)).toBe(0);
  });

  it('is monotonic and stays within [-1, 1]', () => {
    let prev = -Infinity;
    let violations = 0;
    for (let i = -100_000; i <= 100_000; i++) {
      const v = tanWarp(i / 100_000);
      if (v < prev || v < -1 || v > 1) {
        violations++;
      }
      prev = v;
    }
    expect(violations).toBe(0);
  });

  it('compresses the middle of the face relative to the edges', () => {
    // The whole point of the tangent adjustment: equal steps in u map to
    // smaller steps near the centre than a linear mapping would.
    expect(tanWarp(0.5)).toBeLessThan(0.5);
    expect(tanWarp(0.9)).toBeLessThan(0.9);
  });
});

describe('atanWarpInverse', () => {
  it('round-trips tanWarp to within 2 ulp', () => {
    let maxUlp = 0;
    let maxAbs = 0;
    for (let i = -200_000; i <= 200_000; i++) {
      const u = i / 200_000;
      const back = atanWarpInverse(tanWarp(u));
      const abs = Math.abs(back - u);
      maxAbs = Math.max(maxAbs, abs);
      if (Math.abs(u) > 1e-3) {
        maxUlp = Math.max(maxUlp, (abs / Math.abs(u)) * 4503599627370496);
      }
    }
    expect(maxUlp).toBeLessThanOrEqual(2);
    expect(maxAbs).toBeLessThan(1e-15);
  });

  it('is exact at the endpoints and centre', () => {
    expect(atanWarpInverse(0)).toBe(0);
    expect(atanWarpInverse(1)).toBe(1);
    expect(atanWarpInverse(-1)).toBe(-1);
  });
});

describe('falloff profiles', () => {
  it('rationalBump peaks at 1 and decays monotonically', () => {
    expect(rationalBump(0, 4)).toBe(1);
    let prev = Infinity;
    for (let i = 0; i <= 1000; i++) {
      const v = rationalBump(i / 100, 4);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThan(0);
      prev = v;
    }
  });

  it('compactFalloff reaches exactly zero at r = 1 and stays there', () => {
    // Exact zero is what bounds the per-tile feature search: a profile with a
    // long tail would make every feature influence every tile.
    expect(compactFalloff(0)).toBe(1);
    expect(compactFalloff(1)).toBe(0);
    expect(compactFalloff(1.5)).toBe(0);
    expect(compactFalloff(1e9)).toBe(0);
  });

  it('compactFalloff is monotonic on [0, 1]', () => {
    let prev = Infinity;
    let violations = 0;
    for (let i = 0; i <= 100_000; i++) {
      const v = compactFalloff(i / 100_000);
      if (v > prev) {
        violations++;
      }
      prev = v;
    }
    expect(violations).toBe(0);
  });
});
