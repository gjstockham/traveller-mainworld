/**
 * The fixture worlds: ten `(UPP, seed, ruleset)` triples spanning the size range.
 *
 * These live in `core`, not in the golden harness, for one reason: the golden
 * manifest hashes them and the viewer renders them, and if there were two
 * copies the worlds you can fly would not be the worlds that are pinned. One
 * definition means "I rendered a fixture" and "that fixture is hashed" are
 * statements about the same object.
 *
 * ## What WP14 changed, and why it is worth a fixture-spec change
 *
 * Phase 0 wrote these specs out by hand. WP9 made each one name a UPP and take
 * its spec from `interpret()` — **except the fBm block, which stayed
 * hand-written and stayed applied on top**, as deliberate test-input diversity:
 * gain either side of 0.5, non-dyadic lacunarity, octave counts up to
 * `MAX_OCTAVES`. That bought discrimination, and it cost the thing the fixture
 * set is for. A world whose fBm parameters no interpreter would ever produce is
 * not a world any UPP produces, so:
 *
 * - the golden manifest pinned ten worlds that the shipping path cannot reach,
 *   while the path a user *can* reach — paste a UPP, get a planet — was pinned
 *   nowhere;
 * - `packages/export`'s tests reach for `FIXTURES`, so an export of a fixture
 *   was an export of something no UPP produces;
 * - and the eight-field override sat between `interpret()` and the generator,
 *   which is exactly where a ruleset regression would hide.
 *
 * So the override is gone (plan §9.1). Every field of every spec below now
 * comes from `interpret(parseUpp(upp), ruleset)` and nothing else, and the
 * fixture-spec hash covers the interpreted spec — which is what makes a
 * `cepheus-1` table edit a CI failure before it reaches a tile (plan §4.3, R7).
 *
 * **The diversity did not vanish; it moved to where it belongs.** `cepheus-1`
 * interprets every world at lacunarity 2 and gain 0.5, so the fixture set no
 * longer covers the awkward fBm parameter lanes. `battery.ts`'s
 * `noise.fbm3.params` case now does, over a million adversarial coordinates per
 * parameter set rather than ten worlds' worth — which is both stronger and the
 * artefact those inputs always belonged in. The battery is *for* kernel
 * functions under hostile inputs; the fixture set is for whole worlds a user can
 * ask for. Each is now only one of those things.
 *
 * ## What the set spans
 *
 * - **Size 1 to A**, one world per code, which is the axis PRD §9.3 names.
 * - **Atmosphere 0 and 1**, the Phase 1 full-fidelity band (plan §1's scope
 *   fence). Not decoration: `interpret` computes `craters.densityScale` as
 *   `craterPreservation × (1 − hydrographics)`, so an Atmo-1 world is a
 *   genuinely different crater field — 0.95 against 1.0 — and its
 *   `regolithMaturity` differs with it. Both values appear at both ends of the
 *   size range, so a bug that reads size where it means atmosphere cannot hide.
 * - **Hydrographics 0** throughout, because Phase 1 has no water pass and a
 *   fixture whose defining feature is unimplemented pins nothing.
 * - **The awkward seed lanes**, unchanged from Phase 0: all-zero, all-ones, the
 *   sign bit set, and one either side. The seed column did not move in WP14, so
 *   a diff in `fixtures.json` is attributable to the spec change alone.
 *
 * ## The coupling this creates, on purpose
 *
 * Deriving fixture specs wholly from `cepheus-1` means an edit to a ruleset
 * table moves the fixture-spec hash and reddens `golden:verify:fixtures` at the
 * preflight, before a single tile is generated. Under the "mint `cepheus-2`,
 * never edit `cepheus-1` in place" rule it never fires spuriously, because
 * `cepheus-1`'s tables do not change.
 */
import { isUppError, parseUpp } from './input/upp.js';
import { CEPHEUS_1_ID, requireRuleset } from './ruleset/index.js';
import { interpret } from './ruleset/interpret.js';
import type { PhysicalWorldSpec, World } from './spec.js';

/** One fixture world: a UPP, the ruleset that read it, and the seed. */
export interface Fixture {
  /** Stable key in the manifest. Part of the fixture-spec hash. */
  readonly id: string;
  /** Why this fixture is in the set. Prose only — deliberately *not* hashed. */
  readonly description: string;
  /**
   * The UPP this world is interpreted from.
   *
   * Held rather than recomputed, because it is what the fixture *is*: the
   * fixture-spec hash covers it alongside the interpreted spec, so a UPP edited
   * without its spec moving (or the reverse, which would mean the interpreter
   * changed) is a visible diff either way.
   */
  readonly upp: string;
  /** Id of the ruleset that interpreted it. Part of the fixture identity (plan §9.1). */
  readonly rulesetId: string;
  readonly world: World;
}

/**
 * Build one fixture by interpreting a UPP under a named ruleset.
 *
 * Both lookups throw on failure, and both should: the arguments are code
 * literals, so a typo here must stop the module loading rather than quietly
 * pin a different planet. `parseUpp` returns a typed error instead of throwing
 * precisely so the viewer can render R1's inline message; that is the right
 * behaviour for a text field and the wrong one for a constant.
 */
function fixture(
  id: string,
  description: string,
  upp: string,
  rulesetId: string,
  seedHi: number,
  seedLo: number,
): Fixture {
  const parsed = parseUpp(upp);
  if (isUppError(parsed)) {
    throw new Error(`fixture '${id}' is not a UPP: '${upp}' — ${parsed.message}`);
  }
  const spec: PhysicalWorldSpec = interpret(parsed, requireRuleset(rulesetId));
  return { id, description, upp, rulesetId, world: { spec, seedHi, seedLo } };
}

/**
 * Ten worlds spanning the size range (implementation plan §7.1, §9.1).
 *
 * Every UPP below is `X`-starport, Hydrographics 0 and zero in every social
 * position. Size and Atmosphere are the two that vary, and they are the two the
 * Phase 1 generator reads.
 */
export const FIXTURES: readonly Fixture[] = Object.freeze([
  fixture(
    'size1-rockball',
    'Smallest supported world, ~1.75% relief — between Rhea (1.0%) and Iapetus (2.7%) at comparable radius. Airless, so crater preservation is 1.0 exactly, the top of the range. All-zero seed, the lane a mixer is most likely to collapse.',
    'X100000-0',
    CEPHEUS_1_ID,
    0x00000000,
    0x00000000,
  ),
  fixture(
    'size2-cinder',
    "Luna's regime: 1.06% relief against Luna's 1.15% at a similar radius — and, like Luna, a trace exosphere rather than a true vacuum, which is the smallest world in the set carrying Atmo 1.",
    'X210000-0',
    CEPHEUS_1_ID,
    0x00000000,
    0x00000001,
  ),
  fixture(
    'size3-ceres',
    '0.79% relief. Between Mercury (0.41%, geologically dead) and Mars (0.86%) — a body with some history. All-ones seed.',
    'X300000-0',
    CEPHEUS_1_ID,
    0xffffffff,
    0xffffffff,
  ),
  fixture(
    'size4-luna',
    "The Mars analogue: 0.875% against Mars's 0.86%, and the most absolute relief in the set, as Mars has in the solar system. Atmo 1, so its crater field is the preserved-but-not-pristine 0.95. Sign-bit seed.",
    'X410000-0',
    CEPHEUS_1_ID,
    0x80000000,
    0x00000000,
  ),
  fixture(
    'size5-mercury',
    '0.65%. No real analogue exists between Mars and Venus, so this interpolates. Airless, and one below the largest all-ones-adjacent seed.',
    'X500000-0',
    CEPHEUS_1_ID,
    0x7fffffff,
    0xffffffff,
  ),
  fixture(
    'size6-mars',
    '0.50%, continuing the interpolation toward Venus. Airless, and the mid-size world where a crater field is dense enough that a placement bug shows as texture rather than as a missing feature.',
    'X600000-0',
    CEPHEUS_1_ID,
    0xdeadbeef,
    0x12345678,
  ),
  fixture(
    'size7-temperate',
    '0.375%, just above Earth. Atmo 1 at the large end of the range, pairing the reduced crater density with a radius where craters are already small next to the body.',
    'X710000-0',
    CEPHEUS_1_ID,
    0x0badf00d,
    0xcafebabe,
  ),
  fixture(
    'size8-earthlike',
    "Earth exactly: 6400 km and 20 km of relief is 0.3125%, against Earth's 0.31%. Airless and dry, which is the whole of the Phase 1 scope fence stated as a planet.",
    'X800000-0',
    CEPHEUS_1_ID,
    0x9e3779b1,
    0x85ebca6b,
  ),
  fixture(
    'size9-large',
    '0.25% — beyond Earth, where relief is small next to the datum and the surface reads as almost smooth. The seed one step off all-zero, which a mixer that collapses on zero will not distinguish from it.',
    'X900000-0',
    CEPHEUS_1_ID,
    0x00000001,
    0x00000000,
  ),
  fixture(
    'sizeA-maximal',
    'Largest supported world at 0.21%, the subtlest relief in the set, and the highest octave count `cepheus-1` produces. Atmo 1, so the largest body also carries the reduced crater density; alternating-bits seed.',
    'XA10000-0',
    CEPHEUS_1_ID,
    0xa5a5a5a5,
    0x5a5a5a5a,
  ),
]);
