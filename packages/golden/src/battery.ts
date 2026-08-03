/**
 * The determinism battery.
 *
 * Every kernel function is evaluated over a large, deliberately hostile input
 * set; the results are hashed; the hashes are compared against a committed
 * manifest. Running this on Node, in every browser, on every OS — and later
 * against the WASM kernel — is what turns "should be identical" into
 * "demonstrably is".
 *
 * This module is the single source of truth for what gets hashed, shared by
 * the Node runner, the CI matrix and the in-browser verification page, so that
 * every platform is definitely measuring the same thing.
 */
import {
  DEFAULT_FBM,
  GEN_VERSION,
  Sfc32,
  TsTileGenerator,
  type World,
  atanCore,
  atanWarpInverse,
  canonicalBytes,
  compactFalloff,
  faceUvToDirection,
  fbm3,
  gradientNoise3,
  hash1,
  hash2,
  hash3,
  hashSeedString,
  lerp,
  makeTileId,
  mix32,
  powi,
  rationalBump,
  sha256Hex,
  smootherstep,
  smoothstep,
  streamSeed,
  tanCore,
  tanWarp,
  tileRng,
} from '@traveller-mainworld/core';

import { adversarialArray, adversarialInputs } from './adversarial.js';

/** Samples per scalar case. The spike plan asks for ≥1e6. */
export const SAMPLES = 1_000_000;

export interface BatteryCase {
  readonly name: string;
  /** Produces the values to hash. Must be a pure function of nothing but code. */
  run(): Float64Array;
}

/** The world used by the composite tile cases. Fixed, so hashes are stable. */
const BATTERY_WORLD: World = {
  spec: {
    radiusKm: 6371,
    terrainAmplitudeM: 8000,
    fbm: DEFAULT_FBM,
  },
  seedHi: 0xdeadbeef,
  seedLo: 0x12345678,
};

function scalarCase(name: string, fn: (x: number) => number, spread = 1): BatteryCase {
  return {
    name,
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      let i = 0;
      for (const x of adversarialInputs(SAMPLES, spread)) {
        out[i++] = fn(x);
      }
      return out;
    },
  };
}

export const BATTERY: readonly BatteryCase[] = Object.freeze([
  // --- arithmetic helpers ---
  scalarCase('ops.powi3', (x) => powi(x, 3)),
  scalarCase('ops.powi7', (x) => powi(x, 7)),
  scalarCase('ops.smoothstep', smoothstep),
  scalarCase('ops.smootherstep', smootherstep),
  scalarCase('ops.lerp', (x) => lerp(-3.25, 7.5, x)),

  // --- integer hashing (exact by construction, but cheap to pin down) ---
  {
    name: 'hash.mix32',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i++) {
        out[i] = mix32(i - 500_000);
      }
      return out;
    },
  },
  {
    name: 'hash.hash1_2_3',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i += 3) {
        const a = i - 500_000;
        out[i] = hash1(a, 7);
        if (i + 1 < SAMPLES) out[i + 1] = hash2(a, a * 3 - 11, 7);
        if (i + 2 < SAMPLES) out[i + 2] = hash3(a, a * 3 - 11, a * -7 + 5, 7);
      }
      return out;
    },
  },

  // --- PRNG ---
  {
    name: 'rng.sfc32',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      const r = new Sfc32(0x12345678, 0x9abcdef0, 0x0f1e2d3c, 0x4b5a6978);
      for (let i = 0; i < SAMPLES; i++) {
        out[i] = r.nextUint32();
      }
      return out;
    },
  },
  {
    name: 'rng.streamSeed',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i += 4) {
        const seed = streamSeed(0xdeadbeef, 0x12345678, i * 7919, i % 5);
        for (let k = 0; k < 4 && i + k < SAMPLES; k++) {
          out[i + k] = seed[k]!;
        }
      }
      return out;
    },
  },
  {
    name: 'rng.tileRng',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      let i = 0;
      let tile = 0;
      while (i < SAMPLES) {
        const r = tileRng(0xcafebabe, 0x0badf00d, tile * 104729, 0);
        for (let k = 0; k < 16 && i < SAMPLES; k++) {
          out[i++] = r.nextUnit();
        }
        tile++;
      }
      return out;
    },
  },
  {
    name: 'rng.hashSeedString',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i += 2) {
        const h = hashSeedString(`seed-${i}-Ω世界`);
        out[i] = h[0]!;
        if (i + 1 < SAMPLES) out[i + 1] = h[1]!;
      }
      return out;
    },
  },

  // --- transcendental replacements: the whole reason Spike A exists ---
  scalarCase('approx.tanCore', (x) => tanCore(x % 0.7853981633974483)),
  scalarCase('approx.atanCore', atanCore),
  scalarCase('approx.tanWarp', (x) => tanWarp(Math.max(-1, Math.min(1, x)))),
  scalarCase('approx.atanWarpInverse', (x) => atanWarpInverse(Math.max(-1, Math.min(1, x)))),
  scalarCase('approx.rationalBump', (x) => rationalBump(x * x, 4)),
  scalarCase('approx.compactFalloff', compactFalloff),

  // --- noise ---
  {
    name: 'noise.gradient3',
    run(): Float64Array {
      const xs = adversarialArray(SAMPLES, 1e-3);
      const out = new Float64Array(SAMPLES);
      // Folded into the documented lattice domain (|coord| < 2³¹). Beyond it
      // the integer hash wraps and the result is meaningless — hashing
      // undefined behaviour would pin down a value nobody intends to preserve.
      const fold = (v: number): number => v % 1e6;
      for (let i = 0; i < SAMPLES; i++) {
        const x = fold(xs[i]!);
        out[i] = gradientNoise3(x, x * 0.37 - 11.25, x * -0.61 + 3.5, 12345);
      }
      return out;
    },
  },
  {
    name: 'noise.fbm3',
    run(): Float64Array {
      const out = new Float64Array(SAMPLES);
      const STRIDE = 0.6180339887498949;
      let acc = 0;
      for (let i = 0; i < SAMPLES; i++) {
        acc += STRIDE;
        const t = acc % 13;
        out[i] = fbm3(t, t * 0.41 - 2.5, t * -0.83 + 1.25, 999, DEFAULT_FBM);
      }
      return out;
    },
  },

  // --- geometry ---
  {
    name: 'geometry.faceUvToDirection',
    run(): Float64Array {
      // Every face, on a grid dense enough to include all edges and corners.
      const STEPS = 235; // 6 faces x 236² x 3 = 1_002_528 values
      const out = new Float64Array(6 * (STEPS + 1) * (STEPS + 1) * 3);
      let k = 0;
      for (let face = 0; face < 6; face++) {
        for (let j = 0; j <= STEPS; j++) {
          for (let i = 0; i <= STEPS; i++) {
            const d = faceUvToDirection(face, i / STEPS, j / STEPS);
            out[k++] = d.x;
            out[k++] = d.y;
            out[k++] = d.z;
          }
        }
      }
      return out;
    },
  },

  // --- composite: the thing that actually ships ---
  {
    name: 'tile.composite',
    run(): Float64Array {
      // A fixed tile set spanning all six faces and depths 0-6, which is the
      // shape the golden manifest fixtures take in WP7.
      //
      // n = 128 gives the 129² grid the spike plan uses as the representative
      // Phase-1 tile, so this case exercises the real shipping workload — and
      // 42 tiles × 129² × 2 buffers clears the ≥1e6 sample bar.
      const gen = new TsTileGenerator(GEN_VERSION);
      const n = 128;
      const per = (n + 1) * (n + 1);
      const tiles: number[] = [];
      for (let face = 0; face < 6; face++) {
        for (let depth = 0; depth <= 6; depth++) {
          let path = 0;
          for (let d = 0; d < depth; d++) {
            path = path * 4 + ((face + d) % 4);
          }
          tiles.push(makeTileId(face, depth, path));
        }
      }
      const out = new Float64Array(tiles.length * per * 2);
      let k = 0;
      for (const id of tiles) {
        const tile = gen.generate(id, BATTERY_WORLD, n);
        for (let i = 0; i < per; i++) {
          out[k++] = tile.elevation[i]!;
        }
        for (let i = 0; i < per; i++) {
          out[k++] = tile.materials[i]!;
        }
      }
      return out;
    },
  },
]);

export interface BatteryResult {
  readonly name: string;
  readonly hash: string;
  readonly samples: number;
}

/**
 * Run one case and hash its canonical bytes.
 *
 * Rejects NaN before hashing. NaN bit patterns are unspecified in JS and WASM
 * alike, so a single NaN anywhere in a case makes its hash non-reproducible —
 * which would silently turn a cross-platform comparison into noise. Infinity is
 * fine: it has one bit pattern and compares cleanly.
 */
export function runCase(c: BatteryCase): BatteryResult {
  const values = c.run();
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) {
      throw new Error(
        `battery case '${c.name}' produced NaN at index ${i}. ` +
          'NaN bit patterns are not portable, so this value cannot be hashed. ' +
          'Constrain the inputs to the function’s documented domain.',
      );
    }
  }
  return { name: c.name, hash: sha256Hex(canonicalBytes(values)), samples: values.length };
}

/** Run the whole battery. */
export function runBattery(onProgress?: (r: BatteryResult) => void): BatteryResult[] {
  const results: BatteryResult[] = [];
  for (const c of BATTERY) {
    const r = runCase(c);
    results.push(r);
    onProgress?.(r);
  }
  return results;
}

/** Hash of the whole battery — one number to compare across platforms. */
export function batteryDigest(results: readonly BatteryResult[]): string {
  const joined = results.map((r) => `${r.name}:${r.hash}`).join('\n');
  const bytes = new Uint8Array(joined.length);
  for (let i = 0; i < joined.length; i++) {
    bytes[i] = joined.charCodeAt(i) & 0xff;
  }
  return sha256Hex(bytes);
}
