/**
 * The fixture worlds: ten `PhysicalWorldSpec`s spanning the size range.
 *
 * These live in `core`, not in the golden harness, for one reason: the golden
 * manifest hashes them and the viewer renders them, and if there were two
 * copies the worlds you can fly would not be the worlds that are pinned. One
 * definition means "I rendered a fixture" and "that fixture is hashed" are
 * statements about the same object.
 *
 * ## What WP9 changed here, and what it deliberately did not
 *
 * Phase 0 wrote these specs out by hand, because there was no interpreter.
 * There is one now, so each fixture names an **airless UPP** and takes its spec
 * from `interpret()` — which is where the R5 fields the spec grew in WP9 come
 * from, without ten hand-written blobs to keep in step with the tables.
 *
 * The radii and relief figures are unchanged to the bit, and that is not luck:
 * `cepheus-1`'s Size table *is* the Phase 0 fixture curve, adopted deliberately
 * so that landing the interpreter moved no golden hash. Size N interprets to
 * `N × 800 km` and to the relief figure the `289a78e5…` fixture set tuned
 * against real solar-system bodies (see `CHANGELOG.md`).
 *
 * **The fBm parameters stay hand-written and stay overridden**, because they
 * are not a physical claim — they are deliberate test-input diversity. The set
 * spans gain either side of 0.5, non-dyadic lacunarity, and octave counts from
 * a handful up to `MAX_OCTAVES`, so that a change to how lacunarity, gain or
 * octave count are consumed cannot pass unnoticed. A set that took the
 * interpreter's smooth curve would hash ten worlds differing only in seed,
 * radius and relief, and would discriminate far less. **WP14 owns the
 * decision** of what regenerated fixtures do about this; it is a fixture-spec
 * change under the change protocol and it does not belong here.
 *
 * Seeds likewise stay as they are, covering the awkward lanes: all-zero,
 * all-ones, the sign bit set, and one either side of them.
 *
 * ## The coupling this creates, on purpose
 *
 * Deriving fixture specs from `cepheus-1` means an edit to a ruleset table
 * moves the fixture-spec hash and reddens `golden:verify:fixtures`. That is
 * Phase 1 plan §4.3's enforcement arriving early and for free — and under the
 * "mint `cepheus-2`, never edit `cepheus-1` in place" rule it never fires
 * spuriously, because `cepheus-1`'s tables do not change.
 */
import type { FbmParams } from './kernel/fbm.js';
import { interpretText } from './ruleset/interpret.js';
import type { PhysicalWorldSpec, World } from './spec.js';

/** One fixture world: a spec plus the seed that instantiates it. */
export interface Fixture {
  /** Stable key in the manifest. Part of the fixture-spec hash. */
  readonly id: string;
  /** Why this fixture is in the set. Prose only — deliberately *not* hashed. */
  readonly description: string;
  readonly world: World;
}

/**
 * Build one fixture: interpret an airless UPP, then override the fBm.
 *
 * The `upp` argument is a code literal, so `interpretText`'s throw-on-malformed
 * behaviour is what is wanted — a typo here should stop the module loading, not
 * quietly pin a different planet.
 */
function fixture(
  id: string,
  description: string,
  upp: string,
  fbm: FbmParams,
  seedHi: number,
  seedLo: number,
): Fixture {
  const spec: PhysicalWorldSpec = { ...interpretText(upp), fbm };
  return { id, description, world: { spec, seedHi, seedLo } };
}

/**
 * Ten worlds spanning the size range (implementation plan §7.1).
 *
 * Every UPP below is `X`-starport, Atmosphere 0, Hydrographics 0 and zero in
 * every social position — the airless, dry regime Phase 1 generates at full
 * fidelity (plan §1 scope fence). Only the Size digit varies, which is the
 * axis this set exists to span.
 */
export const FIXTURES: readonly Fixture[] = Object.freeze([
  fixture(
    'size1-rockball',
    'Smallest supported world, ~1.75% relief — between Rhea (1.0%) and Iapetus (2.7%) at comparable radius. All-zero seed, the lane a mixer is most likely to collapse.',
    'X100000-0',
    { octaves: 6, frequency: 0.8, amplitude: 1, lacunarity: 2, gain: 0.5 },
    0x00000000,
    0x00000000,
  ),
  fixture(
    'size2-cinder',
    "Luna's regime: 1.06% relief against Luna's 1.15% at a similar radius. Low gain, so the deep octaves contribute near-nothing.",
    'X200000-0',
    { octaves: 8, frequency: 1.2, amplitude: 1, lacunarity: 2, gain: 0.45 },
    0x00000000,
    0x00000001,
  ),
  fixture(
    'size3-ceres',
    '0.79% relief. Between Mercury (0.41%, geologically dead) and Mars (0.86%) — a body with some history. All-ones seed.',
    'X300000-0',
    { octaves: 10, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
    0xffffffff,
    0xffffffff,
  ),
  fixture(
    'size4-luna',
    "The Mars analogue: 0.875% against Mars's 0.86%, and the most absolute relief in the set, as Mars has in the solar system. Gain above 0.5 gives it the roughness to match.",
    'X400000-0',
    { octaves: 12, frequency: 2.2, amplitude: 1, lacunarity: 2, gain: 0.55 },
    0x80000000,
    0x00000000,
  ),
  fixture(
    'size5-mercury',
    '0.65%. No real analogue exists between Mars and Venus, so this interpolates. Non-dyadic lacunarity — octave frequencies stop being exactly representable.',
    'X500000-0',
    { octaves: 9, frequency: 1.9, amplitude: 1, lacunarity: 1.87, gain: 0.5 },
    0x7fffffff,
    0xffffffff,
  ),
  fixture(
    'size6-mars',
    '0.50%, continuing the interpolation toward Venus. High gain and many octaves together: the largest fBm sums in the set.',
    'X600000-0',
    { octaves: 14, frequency: 2.5, amplitude: 1, lacunarity: 2, gain: 0.6 },
    0xdeadbeef,
    0x12345678,
  ),
  fixture(
    'size7-temperate',
    '0.375%, just above Earth. Non-dyadic lacunarity again, paired with low gain and an odd octave count.',
    'X700000-0',
    { octaves: 11, frequency: 3.1, amplitude: 1, lacunarity: 2.13, gain: 0.42 },
    0x0badf00d,
    0xcafebabe,
  ),
  fixture(
    'size8-earthlike',
    "Earth exactly: 6400 km and 20 km of relief is 0.3125%, against Earth's 0.31%. DEFAULT_FBM unaltered, so the shipping default is pinned here.",
    'X800000-0',
    { octaves: 8, frequency: 1.6, amplitude: 1, lacunarity: 2, gain: 0.5 },
    0x9e3779b1,
    0x85ebca6b,
  ),
  fixture(
    'size9-large',
    '0.25% — beyond Earth, where relief is small next to the datum and the surface reads as almost smooth.',
    'X900000-0',
    { octaves: 16, frequency: 4, amplitude: 1, lacunarity: 2, gain: 0.5 },
    0x00000001,
    0x00000000,
  ),
  fixture(
    'sizeA-maximal',
    'Largest supported world at 0.21%, the subtlest relief in the set. MAX_OCTAVES exactly, the last octave before fbm3 starts clamping.',
    'XA00000-0',
    { octaves: 24, frequency: 5.5, amplitude: 1, lacunarity: 2, gain: 0.5 },
    0xa5a5a5a5,
    0x5a5a5a5a,
  ),
]);
