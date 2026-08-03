import { describe, expect, it } from 'vitest';

import { hash1, hash2, hash3, hashToSigned, hashToUnit, mix32 } from '../src/kernel/hash.js';
import { Sfc32, hashSeedString, streamSeed, tileRng } from '../src/kernel/rng.js';

describe('mix32', () => {
  it('is bijective over a large sample', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200_000; i++) {
      seen.add(mix32(i));
    }
    expect(seen.size).toBe(200_000);
  });

  it('avalanches: flipping one input bit flips ~half the output bits', () => {
    // Per input bit position, count how often each output bit flips.
    for (let bit = 0; bit < 32; bit++) {
      let flipped = 0;
      const trials = 4096;
      for (let i = 0; i < trials; i++) {
        const x = Math.imul(i, 0x9e3779b1);
        const a = mix32(x);
        const b = mix32(x ^ (1 << bit));
        let diff = a ^ b;
        // popcount
        diff = diff - ((diff >>> 1) & 0x55555555);
        diff = (diff & 0x33333333) + ((diff >>> 2) & 0x33333333);
        flipped += (Math.imul((diff + (diff >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
      }
      const meanFlipped = flipped / trials;
      // Ideal is 16 of 32 bits. Anything outside 14-18 indicates structure.
      expect(meanFlipped, `input bit ${bit}`).toBeGreaterThan(14);
      expect(meanFlipped, `input bit ${bit}`).toBeLessThan(18);
    }
  });
});

describe('lattice hashes', () => {
  it('are uniform across byte buckets', () => {
    const buckets = new Uint32Array(256);
    const n = 400_000;
    for (let i = 0; i < n; i++) {
      const x = (i % 73) - 36;
      const y = ((i / 73) | 0) % 71;
      const z = ((i / 5183) | 0) % 67;
      const b = hash3(x, y, z, 12345) >>> 24;
      buckets[b] = buckets[b]! + 1;
    }
    const expected = n / 256;
    for (let b = 0; b < 256; b++) {
      // ±12% is loose enough not to be flaky, tight enough to catch axis bias.
      expect(buckets[b]!, `bucket ${b}`).toBeGreaterThan(expected * 0.88);
      expect(buckets[b]!, `bucket ${b}`).toBeLessThan(expected * 1.12);
    }
  });

  it('does not collapse along any single axis', () => {
    // A naive x*p1 ^ y*p2 ^ z*p3 hash produces identical values on planes.
    const along = new Set<number>();
    for (let x = -500; x < 500; x++) {
      along.add(hash3(x, 7, -3, 99));
    }
    expect(along.size).toBe(1000);
  });

  it('separates permuted coordinates', () => {
    expect(hash3(1, 2, 3, 0)).not.toBe(hash3(3, 2, 1, 0));
    expect(hash3(1, 2, 3, 0)).not.toBe(hash3(2, 1, 3, 0));
    expect(hash2(1, 2, 0)).not.toBe(hash2(2, 1, 0));
    expect(hash1(5, 1)).not.toBe(hash1(1, 5));
  });

  it('maps into the documented ranges', () => {
    // Accumulate violations rather than asserting per iteration: expect() costs
    // ~50us, which would dominate any loop long enough to be worth running.
    let violations = 0;
    for (let i = 0; i < 100_000; i++) {
      const h = hash1(i, 3);
      const u = hashToUnit(h);
      const s = hashToSigned(h);
      if (!(u >= 0 && u < 1 && s >= -1 && s < 1)) {
        violations++;
      }
    }
    expect(violations).toBe(0);
  });
});

describe('Sfc32', () => {
  it('is reproducible from the same seed', () => {
    const a = new Sfc32(1, 2, 3, 4);
    const b = new Sfc32(1, 2, 3, 4);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('survives an all-zero seed', () => {
    const r = new Sfc32(0, 0, 0, 0);
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(r.nextUint32());
    }
    expect(values.size).toBeGreaterThan(90);
  });

  it('produces unit values in [0, 1)', () => {
    const r = new Sfc32(7, 8, 9, 10);
    let min = Infinity;
    let max = -Infinity;
    let outOfRange = 0;
    for (let i = 0; i < 1_000_000; i++) {
      const v = r.nextUnit();
      if (!(v >= 0 && v < 1)) {
        outOfRange++;
      }
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(outOfRange).toBe(0);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });

  it('nextBelow is unbiased', () => {
    const r = new Sfc32(11, 22, 33, 44);
    const counts = new Uint32Array(7);
    const n = 700_000;
    let outOfRange = 0;
    for (let i = 0; i < n; i++) {
      const v = r.nextBelow(7);
      if (!(v >= 0 && v < 7)) {
        outOfRange++;
      }
      counts[v] = counts[v]! + 1;
    }
    expect(outOfRange).toBe(0);
    for (let i = 0; i < 7; i++) {
      expect(counts[i]!).toBeGreaterThan((n / 7) * 0.97);
      expect(counts[i]!).toBeLessThan((n / 7) * 1.03);
    }
  });
});

describe('streamSeed', () => {
  it('is a pure function of its inputs', () => {
    const a = streamSeed(1, 2, 12345, 0);
    const b = streamSeed(1, 2, 12345, 0);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('separates every input dimension', () => {
    const base = streamSeed(1, 2, 12345, 0).join(',');
    expect(streamSeed(2, 2, 12345, 0).join(',')).not.toBe(base); // world seed hi
    expect(streamSeed(1, 3, 12345, 0).join(',')).not.toBe(base); // world seed lo
    expect(streamSeed(1, 2, 12346, 0).join(',')).not.toBe(base); // tile
    expect(streamSeed(1, 2, 12345, 1).join(',')).not.toBe(base); // layer
  });

  it('respects tile bits above 2³²', () => {
    // The high half is easy to drop by accident: `tileId | 0` would truncate it.
    const lo = 12345;
    const hi = lo + 4294967296 * 7;
    expect(streamSeed(1, 2, hi, 0).join(',')).not.toBe(streamSeed(1, 2, lo, 0).join(','));
  });

  it('gives every tile an independent stream regardless of generation order', () => {
    const draw = (tileId: number): number[] => {
      const r = tileRng(0xdeadbeef, 0x12345678, tileId, 0);
      return [r.nextUint32(), r.nextUint32(), r.nextUint32()];
    };

    const ids = [0, 1, 2, 3, 4, 5, 1023, 4294967296 * 3 + 17];
    const forward = ids.map(draw);
    const reverse = [...ids].reverse().map(draw).reverse();
    const shuffled = [3, 0, 7, 1, 6, 2, 5, 4].map((i) => draw(ids[i]!));

    expect(reverse).toEqual(forward);
    for (let i = 0; i < 8; i++) {
      expect(shuffled[i]).toEqual(forward[[3, 0, 7, 1, 6, 2, 5, 4][i]!]);
    }
  });
});

describe('hashSeedString', () => {
  it('is stable and distinguishes similar strings', () => {
    expect(Array.from(hashSeedString('42'))).toEqual(Array.from(hashSeedString('42')));
    expect(hashSeedString('42').join()).not.toBe(hashSeedString('43').join());
    expect(hashSeedString('ab').join()).not.toBe(hashSeedString('ba').join());
    expect(hashSeedString('').join()).not.toBe(hashSeedString('0').join());
  });

  it('handles non-ASCII without a TextEncoder', () => {
    expect(hashSeedString('Ω世界🌍').join()).not.toBe(hashSeedString('Ω世界').join());
  });
});
