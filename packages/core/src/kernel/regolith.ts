/**
 * Regolith: what the surface is made of, and how bright it is (Phase 1 plan §6).
 *
 * Phase 0 classified every vertex into one of four elevation bands. That was
 * defensible while the fBm field *was* the surface, and it stopped being
 * defensible the moment WP10 landed craters: the bands were fractions of
 * `terrainAmplitudeM`, and `spec.ts` now says in terms that this no longer
 * bounds elevation. A crater's depth comes from its diameter and the world's
 * gravity, so on a Luna-sized world a basin floor sits some ten times
 * `terrainAmplitudeM` below the datum — every vertex near a decent crater
 * saturated the bottom band, and the material buffer had quietly become a
 * low-resolution picture of crater depth.
 *
 * So nothing here is relative to elevation. Two fields decide the surface:
 *
 * - **Provinces.** A low-frequency noise field, seeded per world, giving the
 *   mare/highland contrast that makes Luna legible from a glance at a full disc.
 * - **The impact record.** The craters already collected for the relief pass,
 *   walked a second time: flooded basins darken their floors, fresh craters
 *   brighten their ejecta, and rays streak out from the fresh ones.
 *
 * ## Two outputs, one walk
 *
 * {@link surfaceAt} returns a *packed* code rather than an object or a pair of
 * out-parameters. The two outputs share every input and most of the arithmetic,
 * so computing them separately would double the cost of the candidate walk, and
 * this is called once per vertex of every tile. Packing keeps the function pure
 * and allocation-free, which is also what makes it testable as a function rather
 * than as a side effect.
 *
 * ## Albedo is independent of LOD depth, deliberately
 *
 * Only the craters in {@link ALWAYS_ON_BANDS} and the tier-1 basins contribute.
 * Every deeper band is filtered out by one comparison, so the same position
 * gives the same byte at every depth — and albedo needs no counterpart of
 * `lodStepBound`, no term in the viewer's skirt, and no argument about seams at
 * a quadtree boundary.
 *
 * The alternative was to let every gated band contribute, and it fails in a way
 * that elevation's version does not. A crack in the *surface* is hidden by a
 * skirt from behind; a step in *colour* along a tile edge is a coloured line
 * drawn over the planet, and there is nothing behind it to hide it with. The
 * cost is that a 200-metre crater has no bright halo of its own when you are
 * close enough to see it. That is a real loss and a small one: at that range the
 * halo would be a few pixels, while the rays of the big craters — the ones this
 * *does* draw — are what the eye reads as freshness at every range.
 *
 * ## Rays reach exactly as far as the relief support, and no further
 *
 * {@link SUPPORT_RATIO} is 2.2 crater radii, and `CELL_RATIO` is twice it
 * because the neighbourhood lemma in `craters.ts` says so. Real ray systems run
 * much further — Tycho's cross a quarter of the Moon — but reaching past the
 * support here would mean a candidate could affect a sample from two lattice
 * cells away, and the 3×3×3 neighbourhood would stop being a superset of the
 * contributors. That failure is invisible until it is a stripe of missing rays
 * along a cell boundary, which is the exact bug the lattice scheme was chosen to
 * avoid. Longer rays are a 5×5×5 collection for the always-on bands only, at
 * 4.6× their cell lookups; that is a work package, not a constant, and it is
 * recorded as such rather than smuggled in here.
 */
import { compactFalloff } from './approx.js';
import {
  ALWAYS_ON_BANDS,
  BASIN_MIN_RADIUS,
  type CraterCandidates,
  type CraterParams,
  LAYER_REGOLITH,
  SUPPORT_RATIO,
  craterCoverage,
  craterLayerSeed,
  freshness,
} from './craters.js';
import { type FbmParams, fbm3, fbmNormalisation } from './fbm.js';
import { hashToUnit, mix32 } from './hash.js';
import { gradientNoise3 } from './noise.js';
import { clamp, lerp, smoothstep, smootherstep } from './ops.js';

/**
 * What the surface is made of.
 *
 * Four surface classes and water, replacing Phase 0's four elevation bands. They
 * are *materials* rather than heights, which is what lets the palette give each
 * one a hue while {@link surfaceAlbedo} carries the brightness — two independent
 * axes, where the Phase 0 pair was one axis quantised twice.
 *
 * `Water` keeps slot 4 and stays unwritten until Phase 2's sea-level solve. It
 * is here rather than added later for the same reason the whole R5 field set
 * arrived at once in WP9: a class that appears later appears with a hash change
 * attached, and paying that once is cheaper than paying it twice.
 */
export const Material = {
  /** Flooded basin floor — dark, smooth, low-albedo plains. */
  Mare: 0,
  /** Ordinary impact-gardened surface, between the two province extremes. */
  Regolith: 1,
  /** Bright ancient crust: the province field's high end. */
  Highland: 2,
  /** Fresh ejecta and ray systems around a young crater. */
  Ejecta: 3,
  /** Standing liquid. Phase 2; never written in Phase 1. */
  Water: 4,
} as const;

/** How many {@link Material} classes exist. The palette must cover all of them. */
export const MATERIAL_COUNT = 5;

// --- the province field ------------------------------------------------------

/**
 * The albedo province field.
 *
 * Four octaves at a base frequency just above one: broad, basin-scale patches
 * rather than mottling, because this is the field that has to read from orbit.
 * Its finest octave is about eleven cycles across the sphere, which any tile at
 * any depth resolves — so unlike the terrain fBm this is **not** octave-gated by
 * depth, and cannot introduce an LOD step of its own.
 *
 * The base frequency is non-dyadic on `noise.ts`'s advice: a power-of-two base
 * can land first-octave samples on the half-lattice, where the fade weights
 * collapse and the field is drawn from about fourteen distinct values.
 */
const PROVINCE_FBM: FbmParams = {
  octaves: 4,
  frequency: 1.3,
  amplitude: 1,
  lacunarity: 2,
  gain: 0.5,
};

/** Theoretical bound of {@link PROVINCE_FBM}, so the raw field lands in `[-1, 1]`. */
const PROVINCE_NORM = fbmNormalisation(PROVINCE_FBM);

/**
 * How hard the province field is pushed toward its two extremes.
 *
 * fBm reaches its theoretical bound about as often as a coin lands on its edge —
 * the practical range of the normalised field is nearer `±0.4` — so mapping it
 * to `[0, 1]` without gain would give a world of uniform mid-grey with no
 * contrast to see. This multiplies before the clamp, and `smootherstep` after it
 * flattens the two ends into plateaus, which is what turns a smooth gradient
 * into recognisable *provinces* with edges between them.
 */
const PROVINCE_CONTRAST = 2.1;

/**
 * How far a world's province balance can be shifted from even, either way.
 *
 * This is the knob that makes two worlds with the same UPP different places
 * rather than the same place re-rolled: it moves the *fraction* of the surface
 * that reads as dark plains, so one world is a bright cratered highland with a
 * few dark patches and the next is half mare. Small on purpose — beyond about a
 * quarter the field clips against the clamp and worlds start coming out
 * uniformly one thing or the other.
 */
const PROVINCE_BIAS_RANGE = 0.22;

// --- albedo levels -----------------------------------------------------------

/** Albedo of the dark end of the province field. */
const ALBEDO_MARE = 0.24;
/** Albedo of the bright end of the province field. */
const ALBEDO_HIGHLAND = 0.6;
/**
 * How much a thoroughly gardened surface darkens.
 *
 * Space weathering is what makes a mature regolith dark: repeated micrometeorite
 * impacts build a rind of glass and iron on every grain. Modest, because in
 * Phase 1 every airless world interprets to `regolithMaturity = 1` — the
 * interpreter derives it from crater preservation, which is 1 for Atmosphere 0
 * and Hydrographics 0 — so a large coefficient here would be a constant subtracted
 * from every world in the fixture set rather than a difference between them.
 */
const MATURITY_DARKENING = 0.07;

/**
 * Albedo of basalt fill, which a flooded basin replaces its province with.
 *
 * A *replacement* rather than a subtraction, and the first version of this file
 * got that wrong. Subtracting stacks: three overlapping flooded basins took a
 * dark-province sample to −0.09 and every fixture bottomed out at byte 0, so the
 * darkest third of nine worlds was the same flat black. Flooding is a
 * resurfacing — the mare is what is there now, not a shade applied to what was —
 * and the fills of two overlapping basins are the same basalt.
 */
const MARE_ALBEDO = 0.17;
/**
 * How completely the fill replaces the province underneath it.
 *
 * Short of 1 on purpose. A full replacement makes every mare on the world the
 * same single byte, and a flat region of exactly one value is a region with no
 * structure in it at all — measurably so: the darkest byte was identical across
 * all ten fixtures and covered a third of some of them. Leaving a fraction of
 * the province through gives the fill the broad, uneven shading real mare have,
 * for no extra arithmetic.
 */
const MARE_FILL_STRENGTH = 0.82;
/**
 * Fraction of tier-1 basins that flooded, on the smallest and largest worlds.
 *
 * Not all basins flood, and that is the point: mare need a crust thin enough for
 * the melt to reach the surface, so Luna has them on the near side and almost
 * none on the far side. Choosing per basin from its own hash reproduces that
 * asymmetry without modelling any of it, and it is the single largest
 * contributor to a world having a recognisable *face*.
 *
 * **How many flood depends on how big the body is**, and this is the only place
 * in the surface model where body size shows at all — see {@link sizeFactor} for
 * why that matters more than it sounds. Basaltic flooding needs a body large
 * enough to have melted and stayed hot: Vesta and Ceres have none, Luna has
 * about a sixth of its surface, Mercury has extensive smooth plains. A Size 1
 * rockball therefore comes out as uniformly cratered highland, which is what
 * Rhea and Iapetus look like, and a Size A world comes out mostly dark plains.
 */
const MARE_FRACTION_SMALL = 0.03;
const MARE_FRACTION_LARGE = 0.7;
/** Salt for the flooded/unflooded draw, so it does not correlate with the basin's age. */
const MARE_SALT = 0x5bd1e995;

/**
 * Freshness below which a crater has no bright ejecta at all.
 *
 * Above the {@link freshness} floor, so old craters contribute nothing rather
 * than a little: rays are the first thing space weathering erases, and a surface
 * where every crater is faintly bright is a surface with no fresh craters on it.
 */
const EJECTA_FRESH_MIN = 0.7;

/** Peak brightening of the continuous ejecta blanket, at the rim crest. */
const EJECTA_GAIN = 0.26;
/** How far past the rim the continuous blanket reaches, in crater radii. */
const BLANKET_REACH = 0.45;
/** Peak brightening of a ray, where one falls. */
const RAY_GAIN = 0.3;
/**
 * Ceiling on accumulated brightening.
 *
 * Ejecta genuinely adds — two fresh craters overlaying the same ground have laid
 * down two blankets — but a sum with no ceiling clips against the albedo clamp
 * instead, and a clipped region is a flat white patch with its rays and its rim
 * erased inside it. Saturating the term keeps the structure and loses only the
 * unphysical extra brightness.
 */
const EJECTA_CEILING = 0.45;
/**
 * Angular frequency of the ray field, in cycles around the crater.
 *
 * The ray pattern is gradient noise evaluated on the **unit offset direction**
 * from the crater's centre. That direction is constant along a radial line, so
 * any function of it is constant along that line — which is what makes rays come
 * out as rays rather than as a halo, with no tangent frame, no angle and no
 * transcendental anywhere in it.
 */
const RAY_FREQ = 9;
/** Noise value above which a direction carries a ray. Higher gives fewer, narrower rays. */
const RAY_THRESHOLD = 0.15;
/** How sharply a ray's edge cuts. */
const RAY_SHARPNESS = 2.6;
/** Brightening of a fresh crater's own excavated interior. */
const INTERIOR_GAIN = 0.11;
/** How much of the ejecta brightening a fully mature regolith has erased. */
const MATURITY_RAY_SUPPRESSION = 0.35;
/**
 * Ejecta prominence on the smallest and largest worlds.
 *
 * Ejecta leaves a low-gravity body faster than it falls back, so a small world
 * throws its rays further and keeps them brighter for their size. The second of
 * the two places body size reaches the surface, and the subtler one — it is what
 * keeps a Size 1 rockball from reading as a Size 3 one merely dimmed.
 */
const EJECTA_PROMINENCE_SMALL = 1.25;
const EJECTA_PROMINENCE_LARGE = 0.8;

/**
 * Radii, in kilometres, between which the size-dependent terms travel their
 * whole range.
 *
 * The bottom is just under Size 1 (800 km) and the top is Size A (8 000 km), so
 * the ramp spans the supported range rather than saturating partway up it — an
 * earlier version topped out at 4 500 km and left Sizes 5, 8 and A identical,
 * which is three tenths of the fixture set indistinguishable.
 */
const SIZE_RADIUS_MIN_KM = 700;
const SIZE_RADIUS_MAX_KM = 8000;

// --- material thresholds -----------------------------------------------------

/** Brightening above which a sample is called {@link Material.Ejecta}. */
const MATERIAL_EJECTA_AT = 0.1;
/** Mare fill coverage above which a sample is called {@link Material.Mare}. */
const MATERIAL_MARE_AT = 0.45;
/** Province value above which a sample is called {@link Material.Highland}. */
const MATERIAL_HIGHLAND_AT = 0.55;

/**
 * Everything the regolith pass needs from the world, as primitives.
 *
 * Assembled by {@link regolithParams} and shared by both evaluation paths, for
 * the reason {@link CraterParams} is: a derivation done twice is a derivation
 * that can be done differently twice.
 */
export interface RegolithParams {
  /** Seed of the province field. Its own layer, so it perturbs no relief. */
  readonly provinceSeed: number;
  /** Per-world shift of the province balance. See {@link PROVINCE_BIAS_RANGE}. */
  readonly provinceBias: number;
  /** Maturity of the impact-gardened layer, in `[0, 1]`. */
  readonly regolithMaturity: number;
  /** Fraction of basins that flooded. Rises with body size — see {@link sizeFactor}. */
  readonly mareFraction: number;
  /** Multiplier on ejecta and ray brightening. Falls with body size. */
  readonly ejectaProminence: number;
}

/**
 * Where the body sits in the supported size range, in `[0, 1]`.
 *
 * ## Why the surface has to read this at all
 *
 * **WP10's crater field is scale-invariant, and it was not obvious.** Every
 * radius in `craters.ts` — band radii, basin radii, the lattice cell sizes — is a
 * fraction of the planetary radius, and placement happens on the unit sphere. So
 * a Size 1 rockball and a Size A world built from the same seed carry the
 * *identical* crater pattern in unit-sphere coordinates. The fixture set hides
 * it, because each of the ten fixtures also has its own seed.
 *
 * Measured rather than reasoned about: the first version of this file produced
 * bit-identical surfaces for `X100000-0` through `XA00000-0` at one seed, which
 * fails plan §6's acceptance outright. Nothing size-dependent was reaching the
 * colour — the province field is scale-free, and `regolithMaturity` interprets
 * to 1 on every airless world.
 *
 * (In the viewer the sizes *do* look different, because the camera frames every
 * world from the same absolute altitude, so a Size 1 disc is small and its
 * craters read as dense. That is apparent size doing the work, not the field.
 * Worth knowing before anyone cites WP10's "saturated at Size 1–2, sparse at
 * Size 9–A" as a property of the crater distribution.)
 *
 * The two terms this drives are physical consequences of body size, which is why
 * they belong here rather than in the ruleset: they are monotone in a radius, not
 * a judgement about what a UPP code means. The ruleset's deliberate refusal to
 * invent a resurfacing parameter from Size — see `interpret.ts`, which defers it
 * to Phase 3 — is a different question and is untouched.
 */
function sizeFactor(radiusM: number): number {
  const radiusKm = radiusM / 1000;
  return smootherstep(
    clamp((radiusKm - SIZE_RADIUS_MIN_KM) / (SIZE_RADIUS_MAX_KM - SIZE_RADIUS_MIN_KM), 0, 1),
  );
}

/** Assemble {@link RegolithParams} from the world seed and the crater parameters. */
export function regolithParams(
  seedHi: number,
  seedLo: number,
  craters: CraterParams,
): RegolithParams {
  const seed = craterLayerSeed(seedHi, seedLo, LAYER_REGOLITH);
  const size = sizeFactor(craters.radiusM);
  return {
    provinceSeed: seed,
    provinceBias: (hashToUnit(mix32(seed)) - 0.5) * PROVINCE_BIAS_RANGE,
    regolithMaturity: craters.regolithMaturity,
    mareFraction: lerp(MARE_FRACTION_SMALL, MARE_FRACTION_LARGE, size),
    ejectaProminence: lerp(EJECTA_PROMINENCE_SMALL, EJECTA_PROMINENCE_LARGE, size),
  };
}

/**
 * The province value at a position, in `[0, 1]`: 0 is dark plains, 1 is bright
 * highland.
 *
 * Exported because it is the one part of the surface model that is a plain field
 * rather than a walk over craters, and testing it on its own is what
 * distinguishes "the provinces are flat" from "the crater term swamped them".
 */
export function provinceAt(x: number, y: number, z: number, params: RegolithParams): number {
  const raw = fbm3(x, y, z, params.provinceSeed, PROVINCE_FBM) / PROVINCE_NORM;
  return smootherstep(clamp(0.5 + PROVINCE_CONTRAST * (raw - params.provinceBias), 0, 1));
}

/**
 * Whether a basin flooded.
 *
 * Keyed on the basin's own age hash, re-mixed against a salt so that "old" and
 * "flooded" are independent draws. Without the salt the flooded set would be a
 * prefix of the age order, and every mare on every world would be among its
 * oldest basins — true of Luna by accident of history, and not a thing to build
 * in as a law.
 */
function flooded(ageHash: number, fraction: number): boolean {
  return hashToUnit(mix32(ageHash ^ MARE_SALT)) < fraction;
}

/**
 * The ray field around one crater, in `[0, 1]`.
 *
 * `d` is the offset from the crater's centre to the sample and `distance` its
 * length. Normalising gives a unit direction that does not change along a radial
 * line, so sampling noise on it produces streaks that radiate — see
 * {@link RAY_FREQ}.
 *
 * A sample exactly at the centre has no direction, and returns no ray rather
 * than dividing by zero. That branch is reachable — a lattice candidate can land
 * on a vertex — and both evaluation paths take it identically, so it costs
 * nothing beyond the comparison.
 */
function rayAt(dx: number, dy: number, dz: number, distance: number, seed: number): number {
  if (distance <= 0) {
    return 0;
  }
  const inv = 1 / distance;
  const n = gradientNoise3(
    dx * inv * RAY_FREQ,
    dy * inv * RAY_FREQ,
    dz * inv * RAY_FREQ,
    seed,
  );
  return clamp((n - RAY_THRESHOLD) * RAY_SHARPNESS, 0, 1);
}

/**
 * Accumulated brightening and darkening from the impact record — the second walk
 * over the candidate list that Phase 1 plan §6 needs and `compositeCraters`
 * throws away.
 *
 * ## Why a second walk rather than a wider return
 *
 * The relief composite already has every candidate's `t`, radius and age to
 * hand, so accumulating albedo in the same loop would be nearly free. It was not
 * taken, for two reasons. The relief composite is on the hot path of *both*
 * evaluation paths and is where WP15's budget is already tight, and it would
 * grow a second output that most of its callers discard. And the two
 * accumulations do not want the same walk: this one filters to the always-on
 * bands, so it visits a small fraction of the list.
 *
 * ## Why this sums where the relief replaces
 *
 * `compositeCraters` buckets by scale and lets a younger crater *replace*
 * relief inside its bowl, because a crater is cut into the surface it lands on.
 * Albedo is not cut into anything: bright rays fall *across* a dark mare and
 * both are still there. So brightening adds, and the mare term takes a
 * **maximum** — the fills of two overlapping basins are the same basalt, and a
 * sample inside both is not twice flooded.
 *
 * ## What the canonical order is actually doing here, which is less than it looks
 *
 * The walk follows `candidates.order` as plan §5.3 rule 2 asks, and it is worth
 * being straight about how much that buys. A maximum is order-free outright. A
 * sum is not, but reordering one moves it by about 1e-16 — and this output is
 * quantised to a byte, where one step is 1/255. **No permutation of a realistic
 * contributor set reaches a different byte**, which was established by mutating
 * this loop to ignore `order` and finding the whole suite still green.
 *
 * So it is the quantiser, not the ordering, that makes the two evaluation paths
 * agree on colour today. The order stays anyway, for one line's cost, because
 * the day this stops being a sum — a `lerp` toward a brighter value, the shape
 * the relief composite uses — is the day ordering starts moving whole bytes, and
 * a walk that already reads `order` survives that change where one that
 * enumerates by insertion would not. `regolith.test.ts` asserts the
 * insensitivity rather than the ordering, so it goes red on exactly that change
 * rather than passing while proving nothing.
 *
 * **WP14 turned that paragraph into a claim CI makes.** The albedo byte is now
 * pinned in `fixtures.json`, so what a green matrix cell asserts about this
 * function is that its *quantised* output is identical across engines — not
 * that the sum above is. Both halves of that are deliberate and the second is
 * the load-bearing one: a change here smaller than 1/255 everywhere is a change
 * the golden manifest will call clean, and anyone reading a green build as
 * proof that this arithmetic is bit-stable is reading it wrong. The buffer that
 * makes the bit-stability claim is `elevation`, hashed as `Float64` on the same
 * tiles in the same run. See `FixtureResult.albedo` in the golden harness.
 *
 * @param out Two-element scratch: `[brightening, mare fill coverage]`.
 */
function compositeRegolith(
  candidates: CraterCandidates,
  craters: CraterParams,
  params: RegolithParams,
  out: Float64Array,
): void {
  let bright = 0;
  let mare = 0;
  const gain =
    (1 - MATURITY_RAY_SUPPRESSION * params.regolithMaturity) * params.ejectaProminence;

  for (let i = 0; i < candidates.count; i++) {
    const slot = candidates.order[i]!;
    // The depth-independence filter. Basins take a negative scale bucket, so
    // they are always inside it; every band past the always-on pair is not.
    if (candidates.keyBand[slot]! >= ALWAYS_ON_BANDS) {
      continue;
    }

    const t = candidates.t[slot]!;
    const radius = candidates.radius[slot]!;
    const ageHash = candidates.keyAge[slot]!;

    // Mare fill: a flooded basin resurfaces exactly what the impact covered.
    if (radius >= BASIN_MIN_RADIUS && flooded(ageHash, params.mareFraction)) {
      const fill = craterCoverage(t);
      if (fill > mare) {
        mare = fill;
      }
    }

    const fresh = freshness(candidates.age[slot]!, craters.regolithMaturity);
    const weight = smoothstep(
      clamp((fresh - EJECTA_FRESH_MIN) / (1 - EJECTA_FRESH_MIN), 0, 1),
    );
    if (weight <= 0) {
      continue;
    }

    if (t < 1) {
      // Inside the rim the surface is what the impact dug up, and it has not
      // been weathered for as long as anything around it.
      bright = bright + weight * gain * INTERIOR_GAIN * (1 - smootherstep(t));
      continue;
    }

    const blanket = compactFalloff((t - 1) / BLANKET_REACH);
    const reach = compactFalloff((t - 1) / (SUPPORT_RATIO - 1));
    const ray = rayAt(
      candidates.dx[slot]!,
      candidates.dy[slot]!,
      candidates.dz[slot]!,
      t * radius,
      ageHash,
    );
    bright = bright + weight * gain * (EJECTA_GAIN * blanket + RAY_GAIN * ray * reach);
  }

  out[0] = clamp(bright, 0, EJECTA_CEILING);
  out[1] = mare;
}

/** Scratch for {@link compositeRegolith}. Module-level: the kernel is single-threaded per worker. */
const REGOLITH_OUT = new Float64Array(2);

/**
 * Quantise an albedo scalar to the byte the generator writes.
 *
 * **The NaN check is before the cast and not after, because after is too late.**
 * A `Uint8Array` cannot hold a NaN — assigning one stores 0 — so a NaN arriving
 * here would become a plausible dark pixel and a perfectly reproducible hash,
 * which is precisely the class of failure `assertClean` exists to prevent on the
 * elevation buffer and cannot detect on this one.
 */
export function quantiseAlbedo(albedo: number): number {
  const clamped = clamp(albedo, 0, 1);
  if (clamped !== clamped) {
    throw new RangeError(
      'albedo is NaN and would silently quantise to 0; a regolith input was not finite',
    );
  }
  return Math.round(clamped * 255);
}

/** Extract the {@link Material} class from a {@link surfaceAt} code. */
export function surfaceMaterial(code: number): number {
  return code >>> 8;
}

/** Extract the albedo byte, `0`–`255`, from a {@link surfaceAt} code. */
export function surfaceAlbedo(code: number): number {
  return code & 0xff;
}

/**
 * The surface at one position: its material class and its albedo, packed.
 *
 * `material · 256 + albedo`, read back with {@link surfaceMaterial} and
 * {@link surfaceAlbedo}. Both outputs come out of one walk over the candidate
 * list and one evaluation of the province field, and packing is what lets that
 * stay a pure function — the alternative shapes are an allocation per vertex or
 * a module-level out-parameter, and the second is how a "pure" function acquires
 * a hidden dependency on call order.
 *
 * `candidates` must already hold this sample's craters in canonical order. Both
 * evaluation paths pass the very list they built for the relief, which is what
 * makes the two agree bit-for-bit without a second enumeration to keep in step.
 */
export function surfaceAt(
  x: number,
  y: number,
  z: number,
  candidates: CraterCandidates,
  craters: CraterParams,
  params: RegolithParams,
): number {
  const province = provinceAt(x, y, z, params);
  compositeRegolith(candidates, craters, params, REGOLITH_OUT);
  const bright = REGOLITH_OUT[0]!;
  const mare = REGOLITH_OUT[1]!;

  const ground = lerp(
    lerp(ALBEDO_MARE, ALBEDO_HIGHLAND, province),
    MARE_ALBEDO,
    MARE_FILL_STRENGTH * mare,
  );
  const albedo = ground - MATURITY_DARKENING * params.regolithMaturity + bright;

  // Ejecta first: a ray crossing a mare is ejecta lying on mare, and what the
  // eye reads is the ray. Mare next, because a flooded basin is a resurfacing
  // and overrides whatever province it landed in.
  let material = Material.Regolith as number;
  if (bright >= MATERIAL_EJECTA_AT) {
    material = Material.Ejecta;
  } else if (mare >= MATERIAL_MARE_AT) {
    material = Material.Mare;
  } else if (province >= MATERIAL_HIGHLAND_AT) {
    material = Material.Highland;
  }

  return material * 256 + quantiseAlbedo(albedo);
}
