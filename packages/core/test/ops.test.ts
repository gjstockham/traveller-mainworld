import { describe, expect, it } from 'vitest';

import { clamp, lerp, pow2, pow3, powi, smootherstep, smoothstep } from '../src/kernel/ops.js';

describe('powi', () => {
  it('matches repeated multiplication for small exponents', () => {
    expect(powi(3, 0)).toBe(1);
    expect(powi(3, 1)).toBe(3);
    expect(powi(3, 2)).toBe(9);
    expect(powi(2, 10)).toBe(1024);
  });

  it('agrees with pow2/pow3 helpers', () => {
    for (const x of [0.5, 1.25, -2.75, 1e-8, 1e8]) {
      expect(powi(x, 2)).toBe(pow2(x));
    }
    // pow3 multiplies left-to-right (x*x*x); powi squares then multiplies
    // (x²*x), a different rounding sequence, so only exactly-representable
    // inputs are guaranteed to agree.
    expect(powi(3, 3)).toBe(pow3(3));
  });
});

describe('lerp', () => {
  it('returns the endpoints exactly', () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
  });
});

describe('clamp', () => {
  it('constrains to the range', () => {
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });
});

describe('interpolation curves', () => {
  it('are pinned at 0 and 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
  });

  it('are monotonic across the unit interval', () => {
    let prevSmooth = -Infinity;
    let prevSmoother = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const s = smoothstep(t);
      const ss = smootherstep(t);
      expect(s).toBeGreaterThanOrEqual(prevSmooth);
      expect(ss).toBeGreaterThanOrEqual(prevSmoother);
      prevSmooth = s;
      prevSmoother = ss;
    }
  });
});
