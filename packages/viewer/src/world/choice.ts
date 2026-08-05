/**
 * Which world the viewer renders.
 *
 * Three routes:
 *
 * - `?seed=<text>` — the Phase 0 stand-in, a Luna-ish airless rockball, with the
 *   seed hashed to 64 bits. What the viewer has always done.
 * - `?fixture=<id>` — one of the ten golden fixture worlds from `core`.
 * - `?upp=<string>` — **a real UPP, interpreted.** Combines with `?seed=`.
 *
 * ## What `?upp=` is, and what it is not
 *
 * It is not WP12. There is no input UI, no info panel, no reduced-fidelity
 * badge, and no `gen`/`ruleset` parameters — R27's share URL is four parameters
 * and this is two of them. What it is: the only way to look at a world the
 * interpreter actually produced, which until now was impossible.
 *
 * **That gap was wider than it sounds.** Every fixture overrides the fBm
 * parameters after interpreting — deliberately, because the set exists to
 * discriminate and a smooth per-Size curve would hash ten worlds differing only
 * in radius and seed. The default world overrides radius, relief *and* fBm. So
 * no one has ever seen a world built purely from `cepheus-1`'s own numbers, and
 * the Size table's `fbmFrequency` and `fbmOctaves` columns have never been
 * looked at once. This route is where they finally get seen.
 *
 * The fixtures were hashed by WP7 and never once looked at. That is a real gap:
 * a fixture with a degenerate spec — relief so large the displaced surface
 * self-intersects, octaves so high the terrain is uniform noise — would hash
 * perfectly consistently forever and pin nonsense, and nothing in the golden
 * harness would notice, because a hash cannot tell you whether a world looks
 * like a world.
 *
 * It also widens Spike C. Its exit criteria (fps, no stall > 1 s, stable memory
 * over ten minutes) were only ever exercisable against one hardcoded world;
 * `?fixture=` runs them across Cepheus sizes 1 to A, where relief-to-radius
 * spans a factor of forty and the LOD and skirt maths have the most room to be
 * wrong.
 *
 * Selection is a pure function of the query string so it can be tested without
 * a browser. An unknown id is an error naming every valid one, not a silent
 * fallback to the default world: quietly rendering something else is exactly
 * how you convince yourself you have looked at a fixture when you have not.
 */
import {
  DEFAULT_FBM,
  FIXTURES,
  type World,
  hashSeedString,
  interpret,
  interpretText,
  isUppError,
  parseUpp,
} from '@traveller-mainworld/core';

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
  readonly world: World;
}

/** A Luna-like airless rockball: the Phase 0 stand-in, kept as the default. */
export function defaultWorld(seedText: string): WorldChoice {
  const seed = hashSeedString(seedText);
  return {
    label: `Size 8 airless rockball / seed ${seedText}`,
    short: 'default world',
    fixtureId: undefined,
    world: {
      spec: {
        ...interpretText('X200000-0'),
        radiusKm: 1737,
        terrainAmplitudeM: 7000,
        fbm: { ...DEFAULT_FBM, octaves: 10 },
      },
      seedHi: seed[0]!,
      seedLo: seed[1]!,
    },
  };
}

/** Every fixture id, in manifest order — for error messages and the picker. */
export function fixtureIds(): string[] {
  return FIXTURES.map((f) => f.id);
}

/**
 * A world from a UPP, exactly as `cepheus-1` interprets it.
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
export function uppWorld(text: string, seedText: string): WorldChoice {
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

  const seed = hashSeedString(seedText);
  const spec = interpret(parsed);
  return {
    label:
      `${parsed.canonical} — ${String(spec.radiusKm)} km radius, ` +
      `${String(spec.terrainAmplitudeM)} m relief, ${String(spec.fbm.octaves)} octaves / ` +
      `seed ${seedText}`,
    short: parsed.canonical,
    fixtureId: undefined,
    world: { spec, seedHi: seed[0]!, seedLo: seed[1]! },
  };
}

/**
 * Resolve the world from a query string.
 *
 * @throws if `fixture` names an id that does not exist.
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

  if (uppText !== null) {
    return uppWorld(uppText, params.get('seed') ?? '42');
  }

  if (fixtureId === null) {
    return defaultWorld(params.get('seed') ?? '42');
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

  const { radiusKm, terrainAmplitudeM, fbm } = fixture.world.spec;
  return {
    label:
      `fixture ${fixture.id} — ${String(radiusKm)} km radius, ` +
      `${String(terrainAmplitudeM)} m relief, ${String(fbm.octaves)} octaves`,
    short: fixture.id,
    fixtureId: fixture.id,
    // The fixture's own `World`, not a copy: this must be the object the golden
    // manifest hashes, or "I rendered a fixture" stops meaning anything.
    world: fixture.world,
  };
}
