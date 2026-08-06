/**
 * The determinism battery.
 *
 * Every kernel function is evaluated over a large, deliberately hostile input
 * set; the results are hashed; the hashes are compared against a committed
 * manifest. Running this on Node, in every browser, on every OS — and against
 * the WASM kernel twin — is what turns "should be identical" into
 * "demonstrably is".
 *
 * This module is the single source of truth for what gets hashed, shared by the
 * Node runner, the CI matrix, the in-browser verification page and the WP3
 * parity comparison, so that every platform and every kernel is definitely
 * measuring the same thing.
 *
 * Cases take the kernel as an argument rather than importing it (see
 * `kernelApi.ts`): a second copy of the battery for the WASM twin could drift
 * from this one, and a comparison between two subtly different batteries proves
 * nothing at all.
 */
import {
  DEFAULT_FBM,
  type FbmParams,
  GEN_VERSION,
  MAX_OCTAVES,
  type World,
  canonicalBytes,
  interpretText,
  makeTileId,
  sha256Hex,
} from '@traveller-mainworld/core';

import { adversarialArray, adversarialInputs } from './adversarial.js';
import type { KernelApi } from './kernelApi.js';

/**
 * Sizes of one battery run.
 *
 * Held as explicit numbers rather than derived from a single sample count,
 * because the geometry and composite cases are structural: their sizes have to
 * reproduce exactly to reproduce a manifest hash, and "235" is not something
 * anyone should have to recover from a square root.
 */
export interface BatterySize {
  /** Samples per scalar case. The spike plan asks for ≥1e6. */
  readonly samples: number;
  /** Grid steps per face edge in the geometry case. */
  readonly geometrySteps: number;
  /** Deepest tile depth in the composite tile set. */
  readonly compositeMaxDepth: number;
  /** Grid resolution of each composite tile; the vertex grid is `(n+1)²`. */
  readonly compositeN: number;
}

/**
 * What the committed manifest was produced with. Changing any of these changes
 * every hash, so it is part of the change protocol, not a tuning knob.
 *
 * `geometrySteps: 235` gives 6 faces × 236² × 3 = 1,002,528 values, and
 * `compositeN: 128` is the 129² grid the spike plan uses as the representative
 * Phase-1 tile — 42 tiles × 129² × 2 buffers, comfortably over the 1e6 bar.
 */
export const FULL_BATTERY: BatterySize = Object.freeze({
  samples: 1_000_000,
  geometrySteps: 235,
  compositeMaxDepth: 6,
  compositeN: 128,
});

/**
 * A reduced run, for the parity test in the unit suite.
 *
 * Its hashes are meaningless against the manifest and it must never be used to
 * produce one — but TS-vs-WASM equality at this size is the same property at a
 * hundredth of the runtime, which is the difference between a check that runs
 * on every commit and one that does not.
 */
export const QUICK_BATTERY: BatterySize = Object.freeze({
  samples: 20_000,
  geometrySteps: 24,
  compositeMaxDepth: 2,
  compositeN: 16,
});

export interface BatteryCase {
  readonly name: string;
  /** Produces the values to hash. Must be a pure function of the kernel and the size. */
  run(k: KernelApi, size: BatterySize): Float64Array;
}

/** The world used by the composite tile cases. Fixed, so hashes are stable. */
const BATTERY_WORLD: World = {
  spec: {
    ...interpretText('X800000-0'),
    radiusKm: 6371,
    terrainAmplitudeM: 8000,
    fbm: DEFAULT_FBM,
  },
  seedHi: 0xdeadbeef,
  seedLo: 0x12345678,
};

/**
 * The ten fBm parameter blocks the Phase 0 fixture set used to carry, moved
 * here in WP14.
 *
 * They are reproduced **verbatim**, and the point of that is that nothing was
 * chosen: this is the same coverage, relocated. Until WP14 the golden fixtures
 * interpreted a UPP and then overrode the fBm block with one of these, which
 * bought exactly this diversity — gain either side of 0.5, two non-dyadic
 * lacunarities, octave counts from 6 up to `MAX_OCTAVES` — at the cost of
 * pinning ten worlds no UPP can produce. The fixtures now interpret cleanly,
 * and `cepheus-1` gives every world lacunarity 2 and gain 0.5, so the awkward
 * lanes would simply have stopped being covered.
 *
 * They belong here anyway, and arguably always did. The fixture set is for
 * whole worlds a user can ask for; the battery is for **kernel functions under
 * hostile inputs**, which is what a non-dyadic lacunarity is — octave
 * frequencies that stop being exactly representable, so the accumulated sum
 * depends on rounding at every step. Here each block gets a hundred thousand
 * adversarial coordinates instead of one world's tiles, which is a stronger
 * check than the one it replaces rather than a weaker one.
 *
 * The last entry is `MAX_OCTAVES` exactly — `fbm3` clamps there, so it is the
 * boundary between a request that is honoured and one that is silently reduced.
 */
export const HOSTILE_FBM: readonly FbmParams[] = Object.freeze([
  { octaves: 6, frequency: 0.8, amplitude: 1, lacunarity: 2, gain: 0.5 },
  { octaves: 8, frequency: 1.2, amplitude: 1, lacunarity: 2, gain: 0.45 },
  { octaves: 10, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
  { octaves: 12, frequency: 2.2, amplitude: 1, lacunarity: 2, gain: 0.55 },
  { octaves: 9, frequency: 1.9, amplitude: 1, lacunarity: 1.87, gain: 0.5 },
  { octaves: 14, frequency: 2.5, amplitude: 1, lacunarity: 2, gain: 0.6 },
  { octaves: 11, frequency: 3.1, amplitude: 1, lacunarity: 2.13, gain: 0.42 },
  { octaves: 8, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
  { octaves: 16, frequency: 4, amplitude: 1, lacunarity: 2, gain: 0.5 },
  { octaves: MAX_OCTAVES, frequency: 5.5, amplitude: 1, lacunarity: 2, gain: 0.5 },
]);

function scalarCase(
  name: string,
  fn: (k: KernelApi, x: number) => number,
  spread = 1,
): BatteryCase {
  return {
    name,
    run(k, size): Float64Array {
      const out = new Float64Array(size.samples);
      let i = 0;
      for (const x of adversarialInputs(size.samples, spread)) {
        out[i++] = fn(k, x);
      }
      return out;
    },
  };
}

export const BATTERY: readonly BatteryCase[] = Object.freeze([
  // --- arithmetic helpers ---
  scalarCase('ops.powi3', (k, x) => k.powi(x, 3)),
  scalarCase('ops.powi7', (k, x) => k.powi(x, 7)),
  scalarCase('ops.smoothstep', (k, x) => k.smoothstep(x)),
  scalarCase('ops.smootherstep', (k, x) => k.smootherstep(x)),
  scalarCase('ops.lerp', (k, x) => k.lerp(-3.25, 7.5, x)),

  // --- integer hashing (exact by construction, but cheap to pin down) ---
  {
    name: 'hash.mix32',
    run(k, size): Float64Array {
      const out = new Float64Array(size.samples);
      const half = size.samples / 2;
      for (let i = 0; i < size.samples; i++) {
        out[i] = k.mix32(i - half);
      }
      return out;
    },
  },
  {
    name: 'hash.hash1_2_3',
    run(k, size): Float64Array {
      const n = size.samples;
      const out = new Float64Array(n);
      const half = n / 2;
      for (let i = 0; i < n; i += 3) {
        const a = i - half;
        out[i] = k.hash1(a, 7);
        if (i + 1 < n) out[i + 1] = k.hash2(a, a * 3 - 11, 7);
        if (i + 2 < n) out[i + 2] = k.hash3(a, a * 3 - 11, a * -7 + 5, 7);
      }
      return out;
    },
  },

  // --- PRNG ---
  {
    name: 'rng.sfc32',
    run(k, size): Float64Array {
      const out = new Float64Array(size.samples);
      const r = k.newSfc32(0x12345678, 0x9abcdef0, 0x0f1e2d3c, 0x4b5a6978);
      for (let i = 0; i < size.samples; i++) {
        out[i] = r.nextUint32();
      }
      r.free?.();
      return out;
    },
  },
  {
    name: 'rng.streamSeed',
    run(k, size): Float64Array {
      const n = size.samples;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i += 4) {
        const seed = k.streamSeed(0xdeadbeef, 0x12345678, i * 7919, i % 5);
        for (let j = 0; j < 4 && i + j < n; j++) {
          out[i + j] = seed[j]!;
        }
      }
      return out;
    },
  },
  {
    name: 'rng.tileRng',
    run(k, size): Float64Array {
      const out = new Float64Array(size.samples);
      let i = 0;
      let tile = 0;
      while (i < size.samples) {
        const r = k.tileRng(0xcafebabe, 0x0badf00d, tile * 104729, 0);
        for (let j = 0; j < 16 && i < size.samples; j++) {
          out[i++] = r.nextUnit();
        }
        r.free?.();
        tile++;
      }
      return out;
    },
  },
  {
    name: 'rng.hashSeedString',
    run(k, size): Float64Array {
      const n = size.samples;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i += 2) {
        const h = k.hashSeedString(`seed-${i}-Ω世界`);
        out[i] = h[0]!;
        if (i + 1 < n) out[i + 1] = h[1]!;
      }
      return out;
    },
  },

  // --- transcendental replacements: the whole reason Spike A exists ---
  scalarCase('approx.tanCore', (k, x) => k.tanCore(x % 0.7853981633974483)),
  scalarCase('approx.atanCore', (k, x) => k.atanCore(x)),
  scalarCase('approx.tanWarp', (k, x) => k.tanWarp(Math.max(-1, Math.min(1, x)))),
  scalarCase('approx.atanWarpInverse', (k, x) =>
    k.atanWarpInverse(Math.max(-1, Math.min(1, x))),
  ),
  scalarCase('approx.rationalBump', (k, x) => k.rationalBump(x * x, 4)),
  scalarCase('approx.compactFalloff', (k, x) => k.compactFalloff(x)),

  // --- noise ---
  {
    name: 'noise.gradient3',
    run(k, size): Float64Array {
      const xs = adversarialArray(size.samples, 1e-3);
      const out = new Float64Array(size.samples);
      // Folded into the documented lattice domain (|coord| < 2³¹). Beyond it
      // the integer hash wraps and the result is meaningless — hashing
      // undefined behaviour would pin down a value nobody intends to preserve.
      const fold = (v: number): number => v % 1e6;
      for (let i = 0; i < size.samples; i++) {
        const x = fold(xs[i]!);
        out[i] = k.gradientNoise3(x, x * 0.37 - 11.25, x * -0.61 + 3.5, 12345);
      }
      return out;
    },
  },
  {
    name: 'noise.fbm3',
    run(k, size): Float64Array {
      const out = new Float64Array(size.samples);
      const STRIDE = 0.6180339887498949;
      let acc = 0;
      for (let i = 0; i < size.samples; i++) {
        acc += STRIDE;
        const t = acc % 13;
        out[i] = k.fbm3(t, t * 0.41 - 2.5, t * -0.83 + 1.25, 999, DEFAULT_FBM);
      }
      return out;
    },
  },
  {
    name: 'noise.fbm3.params',
    run(k, size): Float64Array {
      // The case above pins one parameter block over a million coordinates.
      // This one pins ten, and the coordinate walk is identical so that a
      // difference between the two hashes is attributable to the parameters
      // alone.
      const out = new Float64Array(size.samples);
      const STRIDE = 0.6180339887498949;
      let acc = 0;
      for (let i = 0; i < size.samples; i++) {
        acc += STRIDE;
        const t = acc % 13;
        const p = HOSTILE_FBM[i % HOSTILE_FBM.length]!;
        out[i] = k.fbm3(t, t * 0.41 - 2.5, t * -0.83 + 1.25, 999, p);
      }
      return out;
    },
  },

  // --- geometry ---
  {
    name: 'geometry.faceUvToDirection',
    run(k, size): Float64Array {
      // Every face, on a grid dense enough to include all edges and corners.
      const steps = size.geometrySteps;
      const out = new Float64Array(6 * (steps + 1) * (steps + 1) * 3);
      let idx = 0;
      for (let face = 0; face < 6; face++) {
        for (let j = 0; j <= steps; j++) {
          for (let i = 0; i <= steps; i++) {
            const d = k.faceUvToDirection(face, i / steps, j / steps);
            out[idx++] = d.x;
            out[idx++] = d.y;
            out[idx++] = d.z;
          }
        }
      }
      return out;
    },
  },

  // --- composite: the thing that actually ships ---
  {
    name: 'tile.composite',
    run(k, size): Float64Array {
      // A fixed tile set spanning all six faces and depths 0..compositeMaxDepth,
      // which is the shape the golden manifest fixtures take in WP7.
      const gen = k.generator(GEN_VERSION);
      const n = size.compositeN;
      const per = (n + 1) * (n + 1);
      const tiles: number[] = [];
      for (let face = 0; face < 6; face++) {
        for (let depth = 0; depth <= size.compositeMaxDepth; depth++) {
          let path = 0;
          for (let d = 0; d < depth; d++) {
            path = path * 4 + ((face + d) % 4);
          }
          tiles.push(makeTileId(face, depth, path));
        }
      }
      // Three buffers per vertex: elevation, material and albedo. Albedo joined
      // in WP11 for the same reason materials was here from the start — this
      // case is the composition of the kernel functions into what actually
      // ships, and a hashed output it did not cover would be a hole in exactly
      // the case named for closing them.
      const out = new Float64Array(tiles.length * per * 3);
      let idx = 0;
      for (const id of tiles) {
        const tile = gen.generate(id, BATTERY_WORLD, n);
        for (let i = 0; i < per; i++) {
          out[idx++] = tile.elevation[i]!;
        }
        for (let i = 0; i < per; i++) {
          out[idx++] = tile.materials[i]!;
        }
        for (let i = 0; i < per; i++) {
          out[idx++] = tile.albedo[i]!;
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
export function runCase(c: BatteryCase, k: KernelApi, size: BatterySize = FULL_BATTERY): BatteryResult {
  const values = c.run(k, size);
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) {
      throw new Error(
        `battery case '${c.name}' produced NaN at index ${i} on the ${k.kind} kernel. ` +
          'NaN bit patterns are not portable, so this value cannot be hashed. ' +
          'Constrain the inputs to the function’s documented domain.',
      );
    }
  }
  return { name: c.name, hash: sha256Hex(canonicalBytes(values)), samples: values.length };
}

/** Run the whole battery against one kernel. */
export function runBattery(
  k: KernelApi,
  size: BatterySize = FULL_BATTERY,
  onProgress?: (r: BatteryResult) => void,
): BatteryResult[] {
  const results: BatteryResult[] = [];
  for (const c of BATTERY) {
    const r = runCase(c, k, size);
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
