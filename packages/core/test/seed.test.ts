import { describe, expect, it } from 'vitest';

import { hashSeedString } from '../src/kernel/rng.js';
import {
  defaultRandomWords,
  randomSeedText,
  rerollSeed,
  resolveSeed,
  type RandomWords,
} from '../src/input/seed.js';

/** A random source that yields a fixed sequence, so a rolled seed is assertable. */
function fixedWords(...values: number[]): RandomWords {
  return (out) => {
    for (let i = 0; i < out.length; i++) out[i] = values[i % values.length] ?? 0;
  };
}

/**
 * A deterministic stand-in for real entropy: different on every call, and the
 * same sequence on every run, so a failure here is reproducible.
 *
 * An incrementing counter would not do. Twelve consecutive integers vary the
 * digits with a period of fifteen calls, so a "every roll differs" test would
 * collide — which is a fair illustration of why the production source is not a
 * counter either.
 */
function pseudoWords(): RandomWords {
  let n = 0x2545f491;
  return (out) => {
    for (let i = 0; i < out.length; i++) {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      out[i] = n;
    }
  };
}

describe('resolveSeed', () => {
  it('uses a supplied seed as given', () => {
    const seed = resolveSeed('luna-1');
    expect(seed.text).toBe('luna-1');
    expect(seed.source).toBe('user');
  });

  it('hashes to the same 64 bits as hashSeedString', () => {
    const hashed = hashSeedString('luna-1');
    const seed = resolveSeed('luna-1');
    expect(seed.hi).toBe(hashed[0]);
    expect(seed.lo).toBe(hashed[1]);
  });

  it('trims, so what is displayed is what is hashed', () => {
    // Untrimmed, '42 ' and '42' would be different worlds while looking
    // identical in the field — and a share URL would carry the difference.
    const padded = resolveSeed('  42  ');
    expect(padded.text).toBe('42');
    expect(padded.hi).toBe(resolveSeed('42').hi);
    expect(padded.lo).toBe(resolveSeed('42').lo);
  });

  it('rolls a seed when the field is blank, and returns it for display (R2)', () => {
    const seed = resolveSeed('', pseudoWords());
    expect(seed.source).toBe('random');
    expect(seed.text.length).toBeGreaterThan(0);
  });

  it('treats whitespace-only, null and undefined as blank', () => {
    for (const blank of ['', '   ', '\t\n', null, undefined]) {
      expect(resolveSeed(blank, pseudoWords()).source).toBe('random');
    }
  });

  it('hashes the rolled seed it reports, not some other value', () => {
    // The R2 failure that matters: displaying one seed and generating from
    // another means the displayed seed does not reproduce the world.
    const seed = resolveSeed('', pseudoWords());
    const hashed = hashSeedString(seed.text);
    expect(seed.hi).toBe(hashed[0]);
    expect(seed.lo).toBe(hashed[1]);
  });

  it('a rolled seed re-resolves to the identical world', () => {
    const rolled = resolveSeed('', pseudoWords());
    const retyped = resolveSeed(rolled.text);
    expect(retyped.hi).toBe(rolled.hi);
    expect(retyped.lo).toBe(rolled.lo);
    expect(retyped.source).toBe('user');
  });
});

describe('randomSeedText', () => {
  it('is decimal digits only, so there is no case to transcribe wrongly', () => {
    const source = pseudoWords();
    for (let i = 0; i < 200; i++) {
      expect(randomSeedText(source)).toMatch(/^[0-9]+$/);
    }
  });

  it('is a fixed width with no leading zero', () => {
    // A leading zero is a digit someone drops when copying, and a dropped digit
    // is a different world.
    expect(randomSeedText(fixedWords(0))).toMatch(/^[1-9][0-9]{11}$/);
    const source = pseudoWords();
    for (let i = 0; i < 500; i++) {
      expect(randomSeedText(source)).toMatch(/^[1-9][0-9]{11}$/);
    }
  });

  it('derives each digit from its own word', () => {
    // Pinned against an injected source, so the derivation is asserted rather
    // than assumed. First digit is 1 + w % 9; the rest are w % 10.
    expect(randomSeedText(fixedWords(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))).toBe('112345678901');
    expect(randomSeedText(fixedWords(8))).toBe('988888888888');
  });

  it('uses the whole word, not just its low byte', () => {
    // `words[i] & 0xff` would pass every test above and quietly throw away 24
    // bits of entropy per digit.
    expect(randomSeedText(fixedWords(256))).not.toBe(randomSeedText(fixedWords(0)));
  });

  it('gives a different seed on each roll (R3)', () => {
    const seen = new Set<string>();
    const source = pseudoWords();
    for (let i = 0; i < 100; i++) seen.add(randomSeedText(source));
    expect(seen.size).toBe(100);
  });
});

describe('rerollSeed', () => {
  it('is always a fresh random seed', () => {
    const seed = rerollSeed(pseudoWords());
    expect(seed.source).toBe('random');
    expect(seed.text).toMatch(/^[1-9][0-9]{11}$/);
  });

  it('produces distinct worlds across rolls under real entropy', () => {
    // The whole point of R3. If the seed source were made deterministic — the
    // change this module's header exists to head off — this goes red.
    const seeds = new Set<string>();
    for (let i = 0; i < 50; i++) seeds.add(rerollSeed().text);
    expect(seeds.size).toBe(50);
  });
});

describe('defaultRandomWords', () => {
  it('fills the array from crypto.getRandomValues', () => {
    const out = new Uint32Array(12);
    defaultRandomWords(out);
    // All-zero from a real CSPRNG has probability 2⁻³⁸⁴; a no-op fill has
    // probability 1, which is what this distinguishes.
    expect(out.some((w) => w !== 0)).toBe(true);
  });

  it('explains itself when Web Crypto is absent', () => {
    const original = Reflect.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      expect(() => defaultRandomWords(new Uint32Array(1))).toThrow(/getRandomValues/);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'crypto');
      } else {
        Object.defineProperty(globalThis, 'crypto', original);
      }
    }
  });
});
