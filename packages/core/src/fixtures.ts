/**
 * The fixture worlds: hand-written `PhysicalWorldSpec`s spanning the size range.
 *
 * These live in `core`, not in the golden harness, for one reason: the golden
 * manifest hashes them and the viewer renders them, and if there were two copies
 * the worlds you can fly would not be the worlds that are pinned. One
 * definition means "I rendered a fixture" and "that fixture is hashed" are
 * statements about the same object.
 *
 * Phase 0 has no ruleset interpreter (PRD R5-R7), so these are written by hand.
 * When the interpreter lands in Phase 1 they get regenerated from real UPPs -
 * a fixture-spec change under the change protocol, not a generator version bump,
 * because editing one alters output for no input a user can reach. See
 * `packages/golden/src/fixtureManifest.ts` for that argument in full.
 *
 * The tile set they are evaluated over, the grid size, and the hashing all stay
 * in the harness. Only the worlds are here.
 */
import type { World } from './spec.js';

/** One fixture world: a hand-written spec plus the seed that instantiates it. */
export interface Fixture {
  /** Stable key in the manifest. Part of the fixture-spec hash. */
  readonly id: string;
  /** Why this fixture is in the set. Prose only — deliberately *not* hashed. */
  readonly description: string;
  readonly world: World;
}

/**
 * Ten worlds spanning the size range (implementation plan §7.1).
 *
 * Phase 0 has no ruleset interpreter (PRD R5–R7, Phase 1), so these specs are
 * hand-written rather than derived from UPPs, and the radii are the Cepheus
 * size codes read literally — roughly `size × 800 km`. When the interpreter
 * lands, these get regenerated from real UPPs under the change protocol, which
 * is a fixture-spec change and nothing else: see `fixtureManifest.ts`.
 *
 * The fBm parameters are not decoration. They are generator inputs, so a
 * fixture set that left them at `DEFAULT_FBM` would hash ten worlds that
 * differed only in seed and radius, and would not discriminate a change to how
 * lacunarity, gain or octave count are consumed. So the set deliberately spans
 * gain either side of 0.5, non-dyadic lacunarity, and octave counts from a
 * handful up to `MAX_OCTAVES` — with one fixture holding `DEFAULT_FBM` exactly,
 * because the shipping default deserves to be pinned too.
 *
 * Seeds likewise cover the awkward lanes: all-zero, all-ones, the sign bit set,
 * and one either side of them.
 */
export const FIXTURES: readonly Fixture[] = Object.freeze([
  {
    id: 'size1-rockball',
    description: 'Smallest supported world, ~1.75% relief — between Rhea (1.0%) and Iapetus (2.7%) at comparable radius. All-zero seed, the lane a mixer is most likely to collapse.',
    world: {
      spec: {
        radiusKm: 800,
        terrainAmplitudeM: 14000,
        fbm: { octaves: 6, frequency: 0.8, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0x00000000,
      seedLo: 0x00000000,
    },
  },
  {
    id: 'size2-cinder',
    description: 'Luna\'s regime: 1.06% relief against Luna\'s 1.15% at a similar radius. Low gain, so the deep octaves contribute near-nothing.',
    world: {
      spec: {
        radiusKm: 1600,
        terrainAmplitudeM: 17000,
        fbm: { octaves: 8, frequency: 1.2, amplitude: 1, lacunarity: 2, gain: 0.45 },
      },
      seedHi: 0x00000000,
      seedLo: 0x00000001,
    },
  },
  {
    id: 'size3-ceres',
    description: '0.79% relief. Between Mercury (0.41%, geologically dead) and Mars (0.86%) — a body with some history. All-ones seed.',
    world: {
      spec: {
        radiusKm: 2400,
        terrainAmplitudeM: 19000,
        fbm: { octaves: 10, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0xffffffff,
      seedLo: 0xffffffff,
    },
  },
  {
    id: 'size4-luna',
    description: 'The Mars analogue: 0.875% against Mars\'s 0.86%, and the most absolute relief in the set, as Mars has in the solar system. Gain above 0.5 gives it the roughness to match.',
    world: {
      spec: {
        radiusKm: 3200,
        terrainAmplitudeM: 28000,
        fbm: { octaves: 12, frequency: 2.2, amplitude: 1, lacunarity: 2, gain: 0.55 },
      },
      seedHi: 0x80000000,
      seedLo: 0x00000000,
    },
  },
  {
    id: 'size5-mercury',
    description: '0.65%. No real analogue exists between Mars and Venus, so this interpolates. Non-dyadic lacunarity — octave frequencies stop being exactly representable.',
    world: {
      spec: {
        radiusKm: 4000,
        terrainAmplitudeM: 26000,
        fbm: { octaves: 9, frequency: 1.9, amplitude: 1, lacunarity: 1.87, gain: 0.5 },
      },
      seedHi: 0x7fffffff,
      seedLo: 0xffffffff,
    },
  },
  {
    id: 'size6-mars',
    description: '0.50%, continuing the interpolation toward Venus. High gain and many octaves together: the largest fBm sums in the set.',
    world: {
      spec: {
        radiusKm: 4800,
        terrainAmplitudeM: 24000,
        fbm: { octaves: 14, frequency: 2.5, amplitude: 1, lacunarity: 2, gain: 0.6 },
      },
      seedHi: 0xdeadbeef,
      seedLo: 0x12345678,
    },
  },
  {
    id: 'size7-temperate',
    description: '0.375%, just above Earth. Non-dyadic lacunarity again, paired with low gain and an odd octave count.',
    world: {
      spec: {
        radiusKm: 5600,
        terrainAmplitudeM: 21000,
        fbm: { octaves: 11, frequency: 3.1, amplitude: 1, lacunarity: 2.13, gain: 0.42 },
      },
      seedHi: 0x0badf00d,
      seedLo: 0xcafebabe,
    },
  },
  {
    id: 'size8-earthlike',
    description: 'Earth exactly: 6400 km and 20 km of relief is 0.3125%, against Earth\'s 0.31%. DEFAULT_FBM unaltered, so the shipping default is pinned here.',
    world: {
      spec: {
        radiusKm: 6400,
        terrainAmplitudeM: 20000,
        fbm: { octaves: 8, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0x9e3779b1,
      seedLo: 0x85ebca6b,
    },
  },
  {
    id: 'size9-large',
    description: '0.25% — beyond Earth, where relief is small next to the datum and the surface reads as almost smooth.',
    world: {
      spec: {
        radiusKm: 7200,
        terrainAmplitudeM: 18000,
        fbm: { octaves: 16, frequency: 4, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0x00000001,
      seedLo: 0x00000000,
    },
  },
  {
    id: 'sizeA-maximal',
    description: 'Largest supported world at 0.21%, the subtlest relief in the set. MAX_OCTAVES exactly, the last octave before fbm3 starts clamping.',
    world: {
      spec: {
        radiusKm: 8000,
        terrainAmplitudeM: 17000,
        fbm: { octaves: 24, frequency: 5.5, amplitude: 1, lacunarity: 2, gain: 0.5 },
      },
      seedHi: 0xa5a5a5a5,
      seedLo: 0x5a5a5a5a,
    },
  },
]);
