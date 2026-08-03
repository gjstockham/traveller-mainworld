import { describe, expect, it } from 'vitest';

import { DEFAULT_FBM, fbm3, fbmNormalisation } from '../src/kernel/fbm.js';
import { hash3 } from '../src/kernel/hash.js';
import {
  billowNoise3,
  gradientNoise3,
  noiseDomainOk,
  ridgedNoise3,
} from '../src/kernel/noise.js';
import { MAX_OCTAVES, OCTAVE_ROTATIONS } from '../src/kernel/rotations.js';

describe('gradientNoise3', () => {
  it('is a pure function of position and seed', () => {
    for (const [x, y, z] of [
      [0.5, 1.5, 2.5],
      [-13.25, 7.125, 0.0625],
      [1e6 + 0.5, -1e6 - 0.25, 3.75],
    ]) {
      expect(gradientNoise3(x!, y!, z!, 42)).toBe(gradientNoise3(x!, y!, z!, 42));
    }
  });

  it('is zero at integer lattice points', () => {
    // A property of gradient noise: the value is the gradient dot a zero offset.
    // Compared with ===, not Object.is: the result is legitimately -0 at some
    // lattice points (the gradient dot negates two zero terms), and -0 is as
    // much "zero" as +0 here. The distinction is preserved in hashes on
    // purpose — see digest/bytes.ts — but it is not a value difference.
    for (let i = -20; i <= 20; i++) {
      expect(gradientNoise3(i, 3, -7, 1) === 0).toBe(true);
    }
  });

  it('stays within [-1, 1] over a large sample', () => {
    let min = Infinity;
    let max = -Infinity;
    let outOfRange = 0;
    for (let i = 0; i < 500_000; i++) {
      const v = gradientNoise3(i * 0.0173, i * 0.0291 - 40, i * 0.0119 + 11, 7);
      if (v < -1 || v > 1) {
        outOfRange++;
      }
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(outOfRange).toBe(0);
    // Should actually use most of the range, or the normalisation is off — an
    // earlier revision over-scaled by 2/√3 and pushed the output past ±1.03.
    expect(min).toBeLessThan(-0.9);
    expect(max).toBeGreaterThan(0.9);
  });

  it('produces no NaN or infinity anywhere in the sampled domain', () => {
    let bad = 0;
    for (let i = 0; i < 200_000; i++) {
      const v = gradientNoise3(i * 0.031 - 3000, i * -0.017 + 900, i * 0.0007, 3);
      if (!Number.isFinite(v)) {
        bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('decorrelates across seeds', () => {
    // Offsets are deliberately generic. On the half-lattice (offsets exactly 0
    // or 0.5) the fade weights collapse to {0, ½, 1} and the field takes only
    // ~14 distinct values, so cross-seed coincidences there are expected and
    // say nothing about seed quality.
    let sameCount = 0;
    for (let i = 0; i < 200_000; i++) {
      const x = i * 0.0371379 + 0.31337;
      if (gradientNoise3(x, 0.4271, -0.7193, 1) === gradientNoise3(x, 0.4271, -0.7193, 2)) {
        sameCount++;
      }
    }
    expect(sameCount).toBe(0);
  });

  it('gives each seed a structurally independent field (regression)', () => {
    // Regression for a real defect: hash3 originally folded the seed in as
    // mix32(seed ^ x). XOR being symmetric made seed and x interchangeable —
    // hash3(117,y,z,2) === hash3(118,y,z,1), because 2^117 === 1^118. Seeds
    // were therefore not independent worlds but the same field with the
    // x-lattice relabelled, which would have made PRD U4 ("re-roll the seed to
    // audition variants") quietly worthless.
    const cellGradients = (x0: number, seed: number): string => {
      const g: number[] = [];
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 2; dy++) {
          for (let dz = 0; dz < 2; dz++) {
            g.push(hash3(x0 + dx, dy, dz, seed) & 15);
          }
        }
      }
      return g.join(',');
    };

    let reproductions = 0;
    for (let x = -300; x < 300; x++) {
      for (let shift = -3; shift <= 3; shift++) {
        if (cellGradients(x, 2) === cellGradients(x + shift, 1)) {
          reproductions++;
        }
      }
    }
    expect(reproductions).toBe(0);
  });

  it('is continuous across lattice cell boundaries', () => {
    // Sample either side of an integer boundary; the field must not jump.
    const eps = 1e-9;
    for (let n = -5; n <= 5; n++) {
      const a = gradientNoise3(n - eps, 0.3, 0.7, 11);
      const b = gradientNoise3(n + eps, 0.3, 0.7, 11);
      expect(Math.abs(a - b)).toBeLessThan(1e-7);
    }
  });

  it('collapses to a small value set on the half-lattice', () => {
    // Documents why base frequencies should not be dyadic: a power-of-two
    // frequency over a regular tile vertex grid would land first-octave
    // samples here systematically and band the terrain visibly.
    const onHalfLattice = new Set<number>();
    const atGenericOffsets = new Set<number>();
    for (let x = 0; x < 4000; x++) {
      onHalfLattice.add(gradientNoise3(x + 0.5, 0.5, 0.5, 1));
      atGenericOffsets.add(gradientNoise3(x + 0.3137, 0.4271, -0.7193, 1));
    }
    expect(onHalfLattice.size).toBeLessThan(40);
    expect(atGenericOffsets.size).toBe(4000);
  });

  it('reports its domain limit', () => {
    expect(noiseDomainOk(1e7, -1e7, 0)).toBe(true);
    expect(noiseDomainOk(3e9, 0, 0)).toBe(false);
  });
});

describe('billow and ridged variants', () => {
  it('stay in [0, 1] and are complements', () => {
    let violations = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = i * 0.0131;
      const b = billowNoise3(x, 2.5, -1.25, 5);
      const r = ridgedNoise3(x, 2.5, -1.25, 5);
      if (b < 0 || b > 1 || r < 0 || r > 1 || Math.abs(b + r - 1) > 1e-15) {
        violations++;
      }
    }
    expect(violations).toBe(0);
  });
});

describe('octave rotations', () => {
  it('provides MAX_OCTAVES matrices', () => {
    expect(OCTAVE_ROTATIONS.length).toBe(MAX_OCTAVES * 9);
  });

  it('are orthonormal (they must not scale the coordinate)', () => {
    // A rotation that scaled would silently change the effective frequency of
    // every later octave.
    for (let o = 0; o < MAX_OCTAVES; o++) {
      const m = o * 9;
      for (let row = 0; row < 3; row++) {
        const a = OCTAVE_ROTATIONS[m + row * 3]!;
        const b = OCTAVE_ROTATIONS[m + row * 3 + 1]!;
        const c = OCTAVE_ROTATIONS[m + row * 3 + 2]!;
        expect(Math.abs(a * a + b * b + c * c - 1), `octave ${o} row ${row}`).toBeLessThan(1e-12);
      }
      // Rows mutually orthogonal.
      for (const [r1, r2] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ]) {
        const dot =
          OCTAVE_ROTATIONS[m + r1! * 3]! * OCTAVE_ROTATIONS[m + r2! * 3]! +
          OCTAVE_ROTATIONS[m + r1! * 3 + 1]! * OCTAVE_ROTATIONS[m + r2! * 3 + 1]! +
          OCTAVE_ROTATIONS[m + r1! * 3 + 2]! * OCTAVE_ROTATIONS[m + r2! * 3 + 2]!;
        expect(Math.abs(dot), `octave ${o} rows ${r1}·${r2}`).toBeLessThan(1e-12);
      }
    }
  });

  it('has no axis-aligned rotation', () => {
    // An axis-aligned rotation leaves one coordinate untouched, defeating the
    // purpose of rotating at all.
    for (let o = 0; o < MAX_OCTAVES; o++) {
      const m = o * 9;
      let axisAligned = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          if (row === col && Math.abs(OCTAVE_ROTATIONS[m + row * 3 + col]! - 1) < 1e-12) {
            axisAligned++;
          }
        }
      }
      expect(axisAligned, `octave ${o} has an identity axis`).toBe(0);
    }
  });
});

describe('fbm3', () => {
  it('is a pure function of its inputs', () => {
    expect(fbm3(0.3, -1.7, 2.1, 9, DEFAULT_FBM)).toBe(fbm3(0.3, -1.7, 2.1, 9, DEFAULT_FBM));
  });

  it('stays within its theoretical normalisation bound', () => {
    const bound = fbmNormalisation(DEFAULT_FBM);
    let max = 0;
    let bad = 0;
    for (let i = 0; i < 200_000; i++) {
      const v = fbm3(i * 0.011, i * -0.007 + 3, i * 0.013 - 8, 21, DEFAULT_FBM);
      if (!Number.isFinite(v)) {
        bad++;
      }
      max = Math.max(max, Math.abs(v));
    }
    expect(bad).toBe(0);
    expect(max).toBeLessThanOrEqual(bound);
    // Octaves rarely peak together, so the practical range is well inside.
    expect(max).toBeGreaterThan(bound * 0.2);
  });

  it('adding octaves refines rather than replaces coarse detail', () => {
    // This is what makes LOD transitions seamless: a deep tile's first N
    // octaves must be bit-identical to a shallow tile's N octaves.
    const shallow = { ...DEFAULT_FBM, octaves: 4 };
    const deep = { ...DEFAULT_FBM, octaves: 10 };
    for (const [x, y, z] of [
      [0.1, 0.2, 0.3],
      [-3.7, 1.1, 8.25],
    ]) {
      const s = fbm3(x!, y!, z!, 5, shallow);
      const d = fbm3(x!, y!, z!, 5, deep);
      const tailBound = fbmNormalisation(deep) - fbmNormalisation(shallow);
      expect(Math.abs(d - s)).toBeLessThanOrEqual(tailBound);
    }
  });

  it('clamps the octave count to the available rotations', () => {
    const capped = fbm3(1.5, 2.5, 3.5, 1, { ...DEFAULT_FBM, octaves: MAX_OCTAVES });
    const over = fbm3(1.5, 2.5, 3.5, 1, { ...DEFAULT_FBM, octaves: MAX_OCTAVES + 50 });
    expect(over).toBe(capped);
  });

  it('normalisation is the sum of octave amplitudes', () => {
    expect(fbmNormalisation({ ...DEFAULT_FBM, octaves: 3, amplitude: 1, gain: 0.5 })).toBe(1.75);
  });
});
