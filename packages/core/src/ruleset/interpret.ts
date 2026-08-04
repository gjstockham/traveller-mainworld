/**
 * The ruleset interpreter (PRD §6.2, R5–R7): `(UPP, ruleset) →
 * PhysicalWorldSpec`.
 *
 * This function is where *all* rules knowledge is assembled. Downstream of it
 * nothing knows what a UPP is: `tilegen.ts` takes primitives rather than the
 * spec object precisely so this layer can evolve without touching hashed code,
 * and that boundary holds in both directions — nothing here reaches into the
 * kernel either.
 *
 * ## This is not kernel code, and its arithmetic still reaches a hash
 *
 * `packages/core/src/kernel/**` has an op whitelist because its arithmetic
 * decides generated output. So does this file's. From WP10 the crater
 * parameters below are read by the tile pass, and from WP14 the whole spec is
 * hashed per golden fixture — so a `Math.pow` here would be exactly as
 * unportable as a `Math.pow` there. `eslint.config.js` therefore extends the
 * banned-transcendental rule to `ruleset/**`, with the differences that this
 * directory may import freely and has no typed-array obligation. `Math.sqrt`
 * is fine: the ECMAScript spec requires it to be correctly rounded.
 *
 * ## Total, by construction
 *
 * Every valid UPP produces a spec. Size 0 is a belt and PRD §3 makes it a
 * permanent non-goal, but the refusal is the app's job — `parseUpp` accepts
 * Size 0 deliberately, and an interpreter that threw on it would push product
 * scope down into a pure function. So Size 0 gets a row, a finite gravity
 * clamp, and a spec nobody should render.
 *
 * ## What the interpreter deliberately does not do
 *
 * Population, Government, Law Level and Tech Level do not appear below. They
 * are not physical, they drive settlement placement from Phase 6, and a spec
 * that varied with them would be a spec that changed a planet's terrain
 * because its law level changed. `interpret.test.ts` asserts that as a
 * property rather than leaving it to this paragraph.
 */
import type { ParsedUpp } from '../input/upp.js';
import { isUppError, parseUpp } from '../input/upp.js';
import type {
  AtmosphereSpec,
  CraterSpec,
  DerivedHints,
  PhysicalWorldSpec,
  TemperatureBand,
} from '../spec.js';
import { CEPHEUS_1 } from './cepheus1/index.js';
import type { Ruleset } from './ruleset.js';
import { rowFor } from './ruleset.js';

/**
 * Interpret a parsed UPP into a physical world specification.
 *
 * Pure and total: the same arguments always produce the same spec, and every
 * valid `ParsedUpp` produces one.
 *
 * @param upp   A successfully parsed UPP. Malformed input never reaches here —
 *              `parseUpp` returns a typed error instead of throwing, and the
 *              caller narrows it.
 * @param ruleset Defaults to {@link CEPHEUS_1}, the default implementation R6
 *              asks for. Pass another to swap the interpretation layer without
 *              touching the generator (R7).
 */
export function interpret(upp: ParsedUpp, ruleset: Ruleset = CEPHEUS_1): PhysicalWorldSpec {
  const t = ruleset.tables;
  const size = rowFor(t.size, upp.size, 'size', ruleset.id);
  const atmo = rowFor(t.atmosphere, upp.atmosphere, 'atmosphere', ruleset.id);
  const hydro = rowFor(t.hydrographics, upp.hydrographics, 'hydrographics', ruleset.id);

  const atmosphere: AtmosphereSpec = {
    pressureBand: atmo.pressureBand,
    pressureBar: atmo.pressureBar,
    composition: atmo.composition,
  };

  const hydrographicCoverage = hydro.coverage;
  const temperatureBand = temperatureFor(atmo.baseTemperature, hydrographicCoverage);

  const hints: DerivedHints = {
    temperatureBand,
    iceLikelihood: iceLikelihoodFor(temperatureBand, hydrographicCoverage, atmo.pressureBar),
    // Relief as a fraction of radius. Both operands come from the same table
    // row, so no table can make this a division by zero.
    terrainRoughness: size.terrainAmplitudeM / (size.radiusKm * 1000),
  };

  // Erosion and standing liquid are the two things that erase an impact
  // record, and they multiply: a wet world with a thick atmosphere keeps
  // almost nothing. Size does *not* appear — impact flux per unit area is
  // roughly independent of body size, and the thing that really resurfaces a
  // large world is geological activity, which is Phase 3's parameter and is
  // deliberately not invented here. What size drives instead is the
  // transition diameter below, and a 28x spread across Size 1–A is a large
  // visual difference on its own.
  const densityScale = atmo.craterPreservation * (1 - hydrographicCoverage);

  const craters: CraterSpec = {
    densityScale,
    // Inverse in gravity, clamped so a belt's zero cannot produce Infinity on
    // a spec that WP14 hashes and WP10 reads.
    transitionDiameterKm:
      t.craterTransitionAt1gKm / Math.max(size.surfaceGravityG, t.minSurfaceGravityG),
    // Regolith saturates: a surface only half as cratered still carries most
    // of its gardened layer, because the layer is built by impactors far
    // smaller than the craters anyone can see. Hence the square root rather
    // than the density itself — and `Math.sqrt` is correctly rounded per the
    // ECMAScript spec, so it is safe on the path to a hash.
    regolithMaturity: Math.sqrt(densityScale),
  };

  return {
    radiusKm: size.radiusKm,
    surfaceGravityG: size.surfaceGravityG,
    atmosphere,
    hydrographicCoverage,
    hints,
    craters,
    terrainAmplitudeM: size.terrainAmplitudeM,
    fbm: {
      octaves: size.fbmOctaves,
      frequency: size.fbmFrequency,
      amplitude: 1,
      lacunarity: 2,
      gain: 0.5,
    },
  };
}

/**
 * Parse and interpret in one step, throwing on a malformed UPP.
 *
 * **For UPP literals written in code, not for user input.** `parseUpp` never
 * throws precisely so the viewer can show R1's inline error; this wrapper
 * exists for the places that hold a UPP as a string constant — the fixture
 * worlds, benchmark worlds, the determinism battery — where a typo should be
 * a loud failure at module load and not a silently different planet.
 */
export function interpretText(text: string, ruleset: Ruleset = CEPHEUS_1): PhysicalWorldSpec {
  const parsed = parseUpp(text);
  if (isUppError(parsed)) {
    throw new Error(`not a UPP: '${text}' — ${parsed.message}`);
  }
  return interpret(parsed, ruleset);
}

/**
 * Adjust the atmosphere's implied thermal regime for standing liquid.
 *
 * One rule, and it is the only inference here that is genuinely sound: **a
 * world with surface liquid is at liquid temperatures.** So hydrographics
 * lifts `extreme` or `cold` to `temperate`. It does not lower `hot` — a hot
 * world can still have oceans, and Phase 4 is where that stops being a
 * hand-wave.
 */
function temperatureFor(base: TemperatureBand, coverage: number): TemperatureBand {
  if (coverage > 0 && (base === 'extreme' || base === 'cold')) return 'temperate';
  return base;
}

/**
 * How likely the world carries surface ice, in `[0, 1]`.
 *
 * Two factors. **Volatiles** must exist at all: standing liquid supplies them
 * outright, an atmosphere supplies some, and an airless dry world supplies
 * none — which is why a Phase 1 vacuum rockball scores exactly zero and a
 * trace-atmosphere one scores a little, the permanently-shadowed-crater ice
 * that Luna and Mercury actually have. **Coldness** then scales it. `extreme`
 * sits below `cold` rather than above: a body with no heat transport has a
 * scorching day side, so ice survives only where the sun never reaches.
 */
function iceLikelihoodFor(
  band: TemperatureBand,
  coverage: number,
  pressureBar: number,
): number {
  const volatiles = coverage > 0 ? 1 : pressureBar > 0 ? 0.25 : 0;
  const coldness =
    band === 'cold' ? 0.9 : band === 'extreme' ? 0.5 : band === 'temperate' ? 0.25 : 0;
  return volatiles * coldness;
}
