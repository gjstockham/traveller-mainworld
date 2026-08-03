/**
 * One interface over both kernels, so the determinism battery can be run
 * against either without being rewritten for it.
 *
 * This matters more than it looks. If the WASM kernel were measured by a second
 * copy of the battery, the two copies could drift — a different stride here, a
 * different fold there — and the comparison would degrade into "both kernels
 * produce plausible numbers" without anyone noticing. Driving one battery
 * through this seam means the inputs are identical by construction and the only
 * thing that differs between runs is the arithmetic under test.
 *
 * Method names mirror the TypeScript kernel's exports, so the WASM adapter is
 * almost entirely a pass-through.
 */
import {
  type Direction,
  type FbmParams,
  OCTAVE_ROTATIONS,
  Sfc32,
  TAN_AT_ONE,
  type TileGenerator,
  TsTileGenerator,
  type WasmKernel,
  WasmTileGenerator,
  atanCore,
  atanWarpInverse,
  compactFalloff,
  faceUvToDirection,
  fbm3,
  gradientNoise3,
  hash1,
  hash2,
  hash3,
  hashSeedString,
  lerp,
  mix32,
  powi,
  rationalBump,
  smootherstep,
  smoothstep,
  streamSeed,
  tanCore,
  tanWarp,
  tileRng,
} from '@traveller-mainworld/core';

/** A drawable RNG stream. `free` exists only on the WASM side. */
export interface RngStream {
  nextUint32(): number;
  nextUnit(): number;
  free?(): void;
}

/** The kernel surface the battery exercises. */
export interface KernelApi {
  readonly kind: 'typescript' | 'wasm';

  powi(x: number, n: number): number;
  smoothstep(t: number): number;
  smootherstep(t: number): number;
  lerp(a: number, b: number, t: number): number;

  mix32(x: number): number;
  hash1(x: number, seed: number): number;
  hash2(x: number, y: number, seed: number): number;
  hash3(x: number, y: number, z: number, seed: number): number;

  newSfc32(s0: number, s1: number, s2: number, s3: number): RngStream;
  tileRng(hi: number, lo: number, tileId: number, layer: number): RngStream;
  streamSeed(hi: number, lo: number, tileId: number, layer: number): Uint32Array;
  hashSeedString(seed: string): Uint32Array;

  tanCore(x: number): number;
  atanCore(x: number): number;
  tanWarp(u: number): number;
  atanWarpInverse(t: number): number;
  rationalBump(r2: number, k: number): number;
  compactFalloff(r: number): number;

  gradientNoise3(x: number, y: number, z: number, seed: number): number;
  fbm3(x: number, y: number, z: number, seed: number, params: FbmParams): number;

  faceUvToDirection(face: number, u: number, v: number): Direction;

  /** A generator over this kernel, for the composite tile case. */
  generator(genVersion: string): TileGenerator;

  // --- constants compared directly, not through a hash ---

  /**
   * `tan(π/4)`, the divisor that makes `tanWarp(±1)` exactly ±1.
   *
   * Compared on its own because a mismatch here explains every other
   * geometry failure at once, and because a downstream hash diff would not say
   * which of the two kernels was wrong.
   */
  tanAtOne(): number;
  /** The fBm inter-octave rotation table. A generated artefact in both kernels. */
  octaveRotations(): Float64Array;
}

/** The pure-TypeScript kernel. */
export function tsKernelApi(): KernelApi {
  return {
    kind: 'typescript',

    powi,
    smoothstep,
    smootherstep,
    lerp,

    mix32,
    hash1,
    hash2,
    hash3,

    newSfc32: (s0, s1, s2, s3) => new Sfc32(s0, s1, s2, s3),
    tileRng,
    streamSeed,
    hashSeedString,

    tanCore,
    atanCore,
    tanWarp,
    atanWarpInverse,
    rationalBump,
    compactFalloff,

    gradientNoise3,
    fbm3,

    faceUvToDirection,

    generator: (genVersion) => new TsTileGenerator(genVersion),

    tanAtOne: () => TAN_AT_ONE,
    octaveRotations: () => OCTAVE_ROTATIONS,
  };
}

/** The Rust/WASM twin. */
export function wasmKernelApi(kernel: WasmKernel): KernelApi {
  return {
    kind: 'wasm',

    powi: kernel.powi,
    smoothstep: kernel.smoothstep,
    smootherstep: kernel.smootherstep,
    lerp: kernel.lerp,

    mix32: kernel.mix32,
    hash1: kernel.hash1,
    hash2: kernel.hash2,
    hash3: kernel.hash3,

    newSfc32: (s0, s1, s2, s3) => kernel.newSfc32(s0, s1, s2, s3),
    tileRng: (hi, lo, tileId, layer) => kernel.tileRng(hi, lo, tileId, layer),
    streamSeed: (hi, lo, tileId, layer) => kernel.streamSeed(hi, lo, tileId, layer),
    hashSeedString: (seed) => kernel.hashSeedString(seed),

    tanCore: kernel.tanCore,
    atanCore: kernel.atanCore,
    tanWarp: kernel.tanWarp,
    atanWarpInverse: kernel.atanWarpInverse,
    rationalBump: kernel.rationalBump,
    compactFalloff: kernel.compactFalloff,

    gradientNoise3: kernel.gradientNoise3,
    fbm3: (x, y, z, seed, params) => kernel.fbm3(x, y, z, seed, params),

    faceUvToDirection: (face, u, v) => kernel.faceUvToDirection(face, u, v),

    generator: (genVersion) => new WasmTileGenerator(genVersion, kernel),

    tanAtOne: () => kernel.tanAtOne(),
    octaveRotations: () => kernel.octaveRotations(),
  };
}
