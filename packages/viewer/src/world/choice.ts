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
 * ## Reduced fidelity moved to `core` in WP13
 *
 * `FidelityReport` and `fidelityFor` were this file's. They are now
 * `core/ruleset/fidelity.ts` and re-exported below, because WP13 gave the scope
 * fence a second consumer: an exported map's title block has to say the same
 * thing the viewer's badge says, and a scope fence stated twice is a scope fence
 * that moves once. Nothing about the behaviour changed — `worldChoice.test.ts`
 * still asserts the same set of positions.
 *
 * **Size 0 is still refused here**, not there. It is a refusal rather than a
 * fidelity note, because PRD §3 makes belts a permanent non-goal rather than a
 * pending phase, and product scope is the app's job.
 *
 * Selection is a pure function of the query string so it can be tested without
 * a browser. An unknown id is an error naming every valid one, not a silent
 * fallback: quietly rendering something else is exactly how you convince
 * yourself you have looked at a fixture when you have not.
 */
import {
  FIXTURES,
  FULL_FIDELITY,
  type FidelityReport,
  type ParsedUpp,
  type Ruleset,
  type World,
  fidelityFor,
  hashSeedString,
  interpret,
  isUppError,
  parseUpp,
  requireRuleset,
} from '@traveller-mainworld/core';

import { rulesetIdFrom } from '../share/url.js';

// Re-exported so the viewer's own modules keep importing them from here — the
// panel, the tests and `main.ts` all name this module for what a world *is*, and
// making them reach into `core/ruleset` for one of the five fields on
// `WorldChoice` would be a worse boundary than the one line below.
export { fidelityFor };
export type { FidelityNote, FidelityReport } from '@traveller-mainworld/core';

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
