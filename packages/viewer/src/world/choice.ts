/**
 * Which world the viewer renders, and how honestly it can render it.
 *
 * Three routes:
 *
 * - `?upp=<string>` — **a real UPP, interpreted.** Combines with `?seed=` and
 *   `?ruleset=`. This is now also what an empty query string resolves to.
 * - `?seed=<text>` — a re-roll of the default UPP.
 * - `?fixture=<id>` — one of the ten golden fixture worlds from `core`.
 *
 * ## The default route is a real UPP from WP12
 *
 * It used to be a hand-built "Phase 0 stand-in": `X200000-0` interpreted and
 * then overridden with Luna's radius, 7 km of relief and ten octaves. That was
 * defensible while the viewer had no input field, because nothing on screen
 * claimed otherwise. It is not defensible now. WP12's UPP field shows the UPP
 * the world was built from, and a field showing `F20076C-F` beside a planet
 * built from three overrides is a lie the user has no way to catch — worse than
 * the old label, because the old label at least said "rockball" rather than
 * naming a code.
 *
 * So the default is {@link DEFAULT_UPP}, interpreted with nothing overridden.
 * The consequence worth knowing is that the Spike C evidence blocks recorded
 * before WP12 were flown against the old stand-in, and its `world` line said
 * `default world`; a block from this build names the UPP instead, which is what
 * makes the two distinguishable rather than silently comparable.
 *
 * ## Reduced fidelity is data, not a string
 *
 * PRD §7 requires every valid UPP (Size 1+) to load at every phase, with codes
 * whose subsystem is not built yet rendering at reduced fidelity behind a badge.
 * {@link FidelityReport} is that badge's content: which positions are not
 * honoured, what the ruleset calls them, and what is actually being drawn
 * instead. Returned as structure rather than as a sentence so the panel decides
 * the wording and the test can assert the *set of positions* — a badge asserted
 * by regex on prose stops testing anything the first time the prose is edited.
 *
 * **Size 0 is not a fidelity note.** It is a refusal, because PRD §3 makes belts
 * a permanent non-goal rather than a pending phase, and a badge saying "not yet"
 * about something that will never come is the worst of both.
 *
 * Selection is a pure function of the query string so it can be tested without
 * a browser. An unknown id is an error naming every valid one, not a silent
 * fallback: quietly rendering something else is exactly how you convince
 * yourself you have looked at a fixture when you have not.
 */
import {
  FIXTURES,
  type ParsedUpp,
  type Ruleset,
  UPP_POSITIONS,
  type World,
  describeUpp,
  hashSeedString,
  interpret,
  isUppError,
  parseUpp,
  requireRuleset,
} from '@traveller-mainworld/core';

import { rulesetIdFrom } from '../share/url.js';

/**
 * The world an empty query string resolves to: Luna, as the Traveller wiki
 * spells it.
 *
 * A Size 2 airless body with a real spaceport class, so the default view is a
 * world somebody could look up rather than a synthetic one — and it is the
 * analogue PRD §9.3 names first. Nothing about it is special to the code: it
 * goes through exactly the same path `?upp=` does.
 */
export const DEFAULT_UPP = 'F20076C-F';

/** The seed used when none is given. Kept from Phase 0 so old links still match. */
export const DEFAULT_SEED = '42';

/** One UPP position this phase does not honour. */
export interface FidelityNote {
  /** The ruleset's display name for the position — "Atmosphere". */
  readonly position: string;
  /** The character as it appears in the canonical spelling. */
  readonly code: string;
  /** The ruleset's own short name for that code. */
  readonly label: string;
  /** What is drawn instead, and which phase changes it. */
  readonly rendered: string;
}

export interface FidelityReport {
  readonly reduced: boolean;
  readonly notes: readonly FidelityNote[];
}

/** The half of a {@link FidelityNote} that comes straight from the ruleset. */
type DescribedFields = Pick<FidelityNote, 'position' | 'code' | 'label'>;

const FULL_FIDELITY: FidelityReport = Object.freeze({ reduced: false, notes: [] });

export interface WorldChoice {
  /** Shown in the title bar and the diagnostics overlay. */
  readonly label: string;
  /**
   * A few characters naming this world, for the overlay's evidence stamp.
   *
   * Every route supplies one. Deriving it from `fixtureId` at the call site
   * worked while there were two routes and silently mislabelled a UPP world as
   * "default world" the moment there were three — and the stamp is what ties a
   * recorded observation to what was on screen, so a wrong one is worse than a
   * vague one.
   */
  readonly short: string;
  /** Fixture id, when this world came from the golden set. */
  readonly fixtureId: string | undefined;
  /** The parsed UPP, when this world came from one. The info panel's input. */
  readonly upp: ParsedUpp | undefined;
  /** The ruleset that interpreted it. Undefined on the fixture route. */
  readonly ruleset: Ruleset | undefined;
  /** The seed as typed and shared. Undefined on the fixture route, which pins its own. */
  readonly seedText: string | undefined;
  readonly fidelity: FidelityReport;
  readonly world: World;
}

/** Every fixture id, in manifest order — for error messages and the picker. */
export function fixtureIds(): string[] {
  return FIXTURES.map((f) => f.id);
}

/**
 * Which positions Phase 1 cannot honour, and what it draws instead.
 *
 * Phase 1 is airless rocky worlds: Atmo 0–1, Hydro 0 (PRD §7). Everything else
 * still renders — that is the requirement — as the rocky world underneath.
 *
 * Population, Government, Law Level and Tech Level are deliberately **not**
 * here. They are not physical and the interpreter never reads them, so there is
 * nothing about the planet they could be said to be degrading; they arrive in
 * Phase 6 as settlement placement, which is an addition rather than a fidelity
 * debt. A badge listing them would be listing four positions the renderer is
 * not wrong about.
 */
export function fidelityFor(upp: ParsedUpp, ruleset: Ruleset): FidelityReport {
  const described = describeUpp(upp, ruleset);

  // Keyed off `UPP_POSITIONS` rather than off a display name, for the reason
  // `describe.ts` gives for doing the same: two copies of "Hydrographics"
  // drift, and the copy that drifts is the one the badge is read from.
  const at = (key: 'atmosphere' | 'hydrographics'): DescribedFields => {
    const index = UPP_POSITIONS.find((p) => p.key === key)?.position;
    const found = described.positions.find((p) => p.position === index);
    if (found === undefined) {
      throw new Error(`ruleset ${ruleset.id} described no ${key} position`);
    }
    return { position: found.name, code: found.code, label: found.label };
  };

  const notes: FidelityNote[] = [];

  if (upp.atmosphere > 1) {
    notes.push({
      ...at('atmosphere'),
      rendered:
        'drawn as a vacuum — sky colour, haze and scattering are Phase 2, and the surface ' +
        'tinting an atmosphere implies is Phase 4',
    });
  }

  if (upp.hydrographics > 0) {
    notes.push({
      ...at('hydrographics'),
      rendered:
        'drawn dry — the sea-level solve against terrain (R8), coastlines and ice caps are ' +
        'Phase 2',
    });
  }

  return notes.length === 0 ? FULL_FIDELITY : { reduced: true, notes };
}

/**
 * A world from a UPP, exactly as its ruleset interprets it.
 *
 * Nothing is overridden. Radius, relief and both fBm columns come from the Size
 * table, which is the whole point — see the module header.
 *
 * **Size 0 is refused here rather than downstream.** PRD §3 makes belts a
 * permanent non-goal: a belt is a system-level feature, not a body, and would
 * need a generator of its own. `parseUpp` accepts Size 0 by design and
 * `interpret` is total over it by design, because product scope is neither the
 * parser's job nor the interpreter's. It is the app's, and this is the app.
 */
export function uppWorld(
  text: string,
  seedText: string,
  rulesetId: string = 'cepheus-1',
): WorldChoice {
  const parsed = parseUpp(text);
  if (isUppError(parsed)) {
    // The parser's message already names the offending position, which is what
    // R1 asks for; prefixing it would only bury that.
    throw new Error(parsed.message);
  }

  if (parsed.size === 0) {
    throw new Error(
      `${parsed.canonical} is Size 0 — an asteroid or planetoid belt, not a single ` +
        'body. Belts are out of scope for this tool (PRD §3): they are a system-level ' +
        'feature and would need a generator of their own. Try Size 1 or above.',
    );
  }

  const ruleset = requireRuleset(rulesetId);
  const seed = hashSeedString(seedText);
  const spec = interpret(parsed, ruleset);
  return {
    label:
      `${parsed.canonical} — ${String(spec.radiusKm)} km radius, ` +
      `${String(spec.terrainAmplitudeM)} m relief, ${String(spec.fbm.octaves)} octaves / ` +
      `seed ${seedText}`,
    short: parsed.canonical,
    fixtureId: undefined,
    upp: parsed,
    ruleset,
    seedText,
    fidelity: fidelityFor(parsed, ruleset),
    world: { spec, seedHi: seed[0]!, seedLo: seed[1]! },
  };
}

/** The world an empty query string gets: {@link DEFAULT_UPP} at the given seed. */
export function defaultWorld(seedText: string): WorldChoice {
  return uppWorld(DEFAULT_UPP, seedText);
}

/**
 * Resolve the world from a query string.
 *
 * @throws if any parameter names something that does not exist, or asks for two
 *         worlds at once. Every refusal names what was asked for.
 */
export function chooseWorld(params: URLSearchParams): WorldChoice {
  const fixtureId = params.get('fixture');
  const uppText = params.get('upp');

  if (fixtureId !== null && uppText !== null) {
    // Same reasoning as `?fixture=` refusing `?seed=`: a fixture is a pinned
    // spec, and a UPP is a request to interpret one. Asking for both is asking
    // for two different worlds, and picking one silently would leave someone
    // believing they had rendered the other.
    throw new Error(`?upp= cannot be combined with ?fixture=${fixtureId}. Drop one.`);
  }

  if (fixtureId === null) {
    return uppWorld(
      uppText ?? DEFAULT_UPP,
      params.get('seed') ?? DEFAULT_SEED,
      rulesetIdFrom(params),
    );
  }

  const fixture = FIXTURES.find((f) => f.id === fixtureId);
  if (fixture === undefined) {
    throw new Error(
      `unknown fixture '${fixtureId}'. Available: ${fixtureIds().join(', ')}`,
    );
  }
  if (params.has('seed')) {
    // Refused rather than ignored. A fixture's seed is part of what the golden
    // manifest pins, so `?fixture=x&seed=y` is asking for something that is not
    // fixture x — and silently dropping the seed would leave someone believing
    // they had re-rolled a fixture when they had not.
    throw new Error(
      `?seed= cannot be combined with ?fixture=${fixture.id}: the seed is part of ` +
        'the pinned fixture spec. Drop one.',
    );
  }
  if (params.has('ruleset')) {
    // And for the same reason. A fixture spec is pinned, not interpreted, so a
    // ruleset id has nothing to act on — accepting one would imply the fixture
    // had been re-interpreted under it, which is precisely what WP14 will make
    // true and what is not true today.
    throw new Error(
      `?ruleset= cannot be combined with ?fixture=${fixture.id}: a fixture's spec is ` +
        'pinned rather than interpreted, so no ruleset is consulted. Drop one.',
    );
  }

  const { radiusKm, terrainAmplitudeM, fbm } = fixture.world.spec;
  return {
    label:
      `fixture ${fixture.id} — ${String(radiusKm)} km radius, ` +
      `${String(terrainAmplitudeM)} m relief, ${String(fbm.octaves)} octaves`,
    short: fixture.id,
    fixtureId: fixture.id,
    upp: undefined,
    ruleset: undefined,
    seedText: undefined,
    // Every fixture is an airless Size 1–A rockball by construction, so none is
    // reduced. Stated rather than derived: there is no UPP here to derive from,
    // and a fixture that stopped being airless would be a fixture-set change
    // under the change protocol rather than something this function should
    // discover.
    fidelity: FULL_FIDELITY,
    // The fixture's own `World`, not a copy: this must be the object the golden
    // manifest hashes, or "I rendered a fixture" stops meaning anything.
    world: fixture.world,
  };
}
