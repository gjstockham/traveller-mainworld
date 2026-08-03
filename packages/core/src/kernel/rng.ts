/**
 * Seeded PRNG and stream derivation.
 *
 * The load-bearing property is not randomness quality but *addressability*:
 * any tile's stream must be derivable from its ID alone, with no dependence on
 * generation order, on sibling tiles, or on how many tiles were generated
 * before it. Tiles arrive on demand, out of order, across several workers, so
 * a generator whose state depends on call history cannot be used.
 */
import { mix32 } from './hash.js';

/** Number of outputs discarded after seeding, to wash out weak initial states. */
const WARMUP_ROUNDS = 12;

/**
 * sfc32 — "small fast counter" — chosen for speed: four 32-bit lanes and no
 * multiplies in the hot path, which matters because tile generation calls this
 * millions of times per tile. Passes PractRand well beyond the volume any
 * single world consumes.
 */
export class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(s0: number, s1: number, s2: number, s3: number) {
    this.a = s0 | 0;
    this.b = s1 | 0;
    this.c = s2 | 0;
    this.d = s3 | 0;
    // An all-zero state is a fixed point of sfc32; perturb it rather than
    // emitting an endless run of zeros.
    if ((this.a | this.b | this.c | this.d) === 0) {
      this.d = 1;
    }
    for (let i = 0; i < WARMUP_ROUNDS; i++) {
      this.nextUint32();
    }
  }

  /** Construct from a 4-lane seed, as produced by {@link streamSeed}. */
  static fromSeed(seed: Uint32Array): Sfc32 {
    return new Sfc32(seed[0]!, seed[1]!, seed[2]!, seed[3]!);
  }

  /** Next 32-bit output, in `[0, 2³²)`. */
  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /**
   * Next double in `[0, 1)`.
   *
   * Only 32 bits of mantissa, which is ample for placement decisions and keeps
   * this to one exact division by a power of two.
   */
  nextUnit(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Next double in `[lo, hi)`. */
  nextRange(lo: number, hi: number): number {
    return lo + this.nextUnit() * (hi - lo);
  }

  /**
   * Uniform integer in `[0, bound)` by rejection sampling, so the result has no
   * modulo bias. Rejection loops terminate with probability 1 and, being driven
   * by the deterministic stream, take the same number of iterations everywhere.
   */
  nextBelow(bound: number): number {
    const b = bound >>> 0;
    if (b === 0) {
      return 0;
    }
    const limit = 4294967296 - (4294967296 % b);
    let v = this.nextUint32();
    while (v >= limit) {
      v = this.nextUint32();
    }
    return v % b;
  }
}

/**
 * Derive a 4-lane RNG seed for one (world, tile, layer) triple.
 *
 * `tileId` is the packed 48-bit key from `tileid.ts`. It is split into two
 * 32-bit halves here because bitwise operators coerce to int32 and would
 * silently discard the high bits.
 *
 * @param worldSeedHi High 32 bits of the 64-bit world seed.
 * @param worldSeedLo Low 32 bits of the 64-bit world seed.
 * @param tileId      Packed tile key (see `tileid.ts`).
 * @param layerId     Distinguishes independent streams within one tile — base
 *                    terrain, each crater size-band, and so on — so adding a
 *                    layer never perturbs the others.
 */
export function streamSeed(
  worldSeedHi: number,
  worldSeedLo: number,
  tileId: number,
  layerId: number,
): Uint32Array {
  // Exact for tileId < 2⁵³: the divisor is a power of two, and `>>> 0` is
  // ToUint32, i.e. modulo 2³².
  const tileHi = Math.floor(tileId / 4294967296);
  const tileLo = tileId >>> 0;

  let acc = 0x9e3779b9 | 0;
  acc = mix32(acc ^ (worldSeedHi | 0));
  acc = mix32(acc ^ (worldSeedLo | 0));
  acc = mix32(acc ^ tileHi);
  acc = mix32(acc ^ tileLo);
  acc = mix32(acc ^ (layerId | 0));

  const out = new Uint32Array(4);
  let s = acc | 0;
  for (let i = 0; i < 4; i++) {
    s = (s + 0x9e3779b9) | 0;
    out[i] = mix32(s);
  }
  return out;
}

/** Convenience: the stream for one (world, tile, layer) triple, ready to draw from. */
export function tileRng(
  worldSeedHi: number,
  worldSeedLo: number,
  tileId: number,
  layerId: number,
): Sfc32 {
  return Sfc32.fromSeed(streamSeed(worldSeedHi, worldSeedLo, tileId, layerId));
}

/**
 * Hash an arbitrary seed string to a 64-bit value, returned as `[hi, lo]` (PRD R2).
 *
 * FNV-1a over UTF-16 code units in two independently-offset lanes, each
 * finalised with `mix32`. Code units rather than a UTF-8 encoding keeps this
 * free of `TextEncoder`, which is not available in every worker context.
 */
export function hashSeedString(seed: string): Uint32Array {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x01000193 | 0;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  const out = new Uint32Array(2);
  out[0] = mix32(h1);
  out[1] = mix32(h2);
  return out;
}
