/**
 * Which world the viewer renders.
 *
 * Two routes, and the second is the point of this module:
 *
 * - `?seed=<text>` — the Phase 0 stand-in, a Luna-ish airless rockball, with the
 *   seed hashed to 64 bits. What the viewer has always done.
 * - `?fixture=<id>` — one of the ten golden fixture worlds from `core`.
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
  interpretText,
} from '@traveller-mainworld/core';

export interface WorldChoice {
  /** Shown in the title bar and the diagnostics overlay. */
  readonly label: string;
  /** Fixture id, when this world came from the golden set. */
  readonly fixtureId: string | undefined;
  readonly world: World;
}

/** A Luna-like airless rockball: the Phase 0 stand-in, kept as the default. */
export function defaultWorld(seedText: string): WorldChoice {
  const seed = hashSeedString(seedText);
  return {
    label: `Size 8 airless rockball / seed ${seedText}`,
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
 * Resolve the world from a query string.
 *
 * @throws if `fixture` names an id that does not exist.
 */
export function chooseWorld(params: URLSearchParams): WorldChoice {
  const fixtureId = params.get('fixture');
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
    fixtureId: fixture.id,
    // The fixture's own `World`, not a copy: this must be the object the golden
    // manifest hashes, or "I rendered a fixture" stops meaning anything.
    world: fixture.world,
  };
}
