import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { assertClean, canonicalBytes, hashFloat64, sha256Hex } from '../src/digest/index.js';

describe('sha256', () => {
  it('matches the NIST test vectors', () => {
    const enc = new TextEncoder();
    expect(sha256Hex(enc.encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex(enc.encode('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with node:crypto across lengths spanning the block boundary', () => {
    // 55/56/57 and 63/64/65 are where the padding logic changes shape.
    for (const len of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4096]) {
      const data = randomBytes(len);
      const expected = createHash('sha256').update(data).digest('hex');
      expect(sha256Hex(new Uint8Array(data)), `length ${len}`).toBe(expected);
    }
  });
});

describe('canonicalBytes', () => {
  it('writes little-endian regardless of host byte order', () => {
    const bytes = canonicalBytes(new Float64Array([1]));
    // 1.0 is 0x3FF0000000000000; little-endian puts the exponent byte last.
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]);
  });

  it('distinguishes +0 from -0', () => {
    expect(hashFloat64(new Float64Array([0]))).not.toBe(hashFloat64(new Float64Array([-0])));
  });

  it('round-trips denormals and extreme values bit-exactly', () => {
    const values = [
      Number.MIN_VALUE, // smallest denormal
      -Number.MIN_VALUE,
      2.2250738585072014e-308, // smallest normal
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.EPSILON,
      1 / 3,
    ];
    const buf = new Float64Array(values);
    const bytes = canonicalBytes(buf);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) {
      expect(view.getFloat64(i * 8, true)).toBe(values[i]);
    }
  });
});

describe('assertClean', () => {
  it('accepts finite buffers, including denormals and signed zeros', () => {
    expect(() => assertClean(new Float64Array([0, -0, Number.MIN_VALUE, -1e300]))).not.toThrow();
  });

  it('rejects NaN and infinities, naming the index', () => {
    expect(() => assertClean(new Float64Array([1, 2, NaN]), 'elevation')).toThrow(
      /elevation\[2\] is NaN/,
    );
    expect(() => assertClean(new Float64Array([Infinity]))).toThrow(/buffer\[0\] is Infinity/);
  });
});
