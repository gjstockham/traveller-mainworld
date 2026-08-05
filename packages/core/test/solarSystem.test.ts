/**
 * `cepheus-1` against the solar system.
 *
 * Every other test in this repository checks the interpreter against itself: is
 * it pure, is it total, does it reproduce a committed expectation table. None of
 * them can say whether the numbers are any *good*. This one compares them to
 * bodies that exist.
 *
 * It is worth having because the Size table is the one piece of `cepheus-1` that
 * makes a falsifiable physical claim — Cepheus reads Size as ~1 600 km of
 * diameter per point, and either that lands near real radii or it does not. It
 * turns out to land within 9% for ten of the twelve bodies below, which is a
 * better result than the rules have any right to and is worth pinning before a
 * future `cepheus-2` quietly moves it.
 *
 * ## Where the UPPs come from, and what has been changed
 *
 * The UPP assignments are the Traveller wiki's for the Terra system
 * (<https://wiki.travellerrpg.com/Terra_(system)>). **They are not Open Game
 * Content** — they are a fan wiki's classification of real astronomical bodies —
 * and they are used here as test inputs only, not shipped as data. The radii and
 * surface descriptions are IAU figures and published observation, not from the
 * wiki.
 *
 * The UPPs are **verbatim**, including the extended spaceport codes (F, G, H,
 * Y) the wiki uses for non-mainworld bodies. They were not, at first: the parser
 * accepted only A–E and X, so eleven of the twelve were rejected and this file
 * substituted an `X` to get at the physics. Being unable to read the only
 * real-world data available to check the ruleset against is what argued the
 * spaceport classes in, and the substitution is gone.
 *
 * Three bodies still cannot be represented: Phobos, Enceladus and Umbriel are
 * Size `S`, below the table's Size 0. They are under the "potato radius" PRD
 * §8.3 defers, so they are left out rather than approximated.
 */
import { describe, expect, it } from 'vitest';

import { isUppError, parseUpp, portKind } from '../src/input/upp.js';
import { describeUpp } from '../src/ruleset/describe.js';
import { interpretText } from '../src/ruleset/interpret.js';

/** How much of its impact record a body has actually kept. */
type Record_ = 'saturated' | 'moderate' | 'sparse';

interface Body {
  readonly name: string;
  /** The wiki's UPP, verbatim. */
  readonly upp: string;
  /** IAU mean radius, km. */
  readonly radiusKm: number;
  /** What the surface actually looks like. */
  readonly record: Record_;
  readonly observed: string;
}

const BODIES: readonly Body[] = [
  { name: 'Mercury', upp: 'G30046A-E', radiusKm: 2440, record: 'saturated',
    observed: 'heavily cratered, close to lunar highlands; Caloris 1550 km' },
  { name: 'Venus', upp: 'G8B0168-E', radiusKm: 6052, record: 'sparse',
    observed: 'globally resurfaced ~500 Ma; ~1000 craters, all young' },
  { name: 'Terra', upp: 'A867A69-F', radiusKm: 6371, record: 'sparse',
    observed: 'almost nothing survives erosion, tectonics and ocean' },
  { name: 'Luna', upp: 'F20076C-F', radiusKm: 1737, record: 'saturated',
    observed: 'saturated highlands plus resurfaced maria; 5185 craters >= 20 km' },
  { name: 'Mars', upp: 'F43056A-F', radiusKm: 3390, record: 'moderate',
    observed: 'southern highlands saturated, northern lowlands resurfaced' },
  { name: 'Ganymede', upp: 'F300468-F', radiusKm: 2634, record: 'moderate',
    observed: '~40% dark cratered terrain, ~60% young grooved terrain' },
  { name: 'Callisto', upp: 'H30016A-F', radiusKm: 2410, record: 'saturated',
    observed: 'the most heavily cratered body known; fully saturated' },
  { name: 'Rhea', upp: 'H100468-E', radiusKm: 764, record: 'saturated',
    observed: 'heavily cratered, close to saturation' },
  { name: 'Titan', upp: 'H3A0168-E', radiusKm: 2575, record: 'sparse',
    observed: 'very few craters: thick atmosphere plus resurfacing' },
  { name: 'Titania', upp: 'H100168-E', radiusKm: 789, record: 'moderate',
    observed: 'moderately cratered, some resurfacing' },
  { name: 'Triton', upp: 'H210169-E', radiusKm: 1353, record: 'sparse',
    observed: 'one of the youngest surfaces known; cryovolcanic, almost no craters' },
  { name: 'Pluto', upp: 'F10046C-F', radiusKm: 1188, record: 'moderate',
    observed: 'mixed: Sputnik Planitia crater-free, elsewhere cratered' },
];

describe('the real UPPs parse as written', () => {
  it('ACCEPTS EVERY BODY WITHOUT EDITING ITS CODE', () => {
    // The reason the spaceport classes exist in the parser. If this reddens,
    // somebody has narrowed the accepted set again and the only real-world
    // check on the ruleset has gone with it.
    for (const body of BODIES) {
      const parsed = parseUpp(body.upp);
      expect(isUppError(parsed) ? parsed.message : 'ok', body.name).toBe('ok');
    }
  });

  it('reads eleven of the twelve as spaceports, and Terra as a starport', () => {
    // Terra is the system's mainworld and is the only one with a starport
    // class. That asymmetry is the whole point of the second set, so it is
    // asserted rather than assumed.
    const kinds = BODIES.map((b) => {
      const parsed = parseUpp(b.upp);
      if (isUppError(parsed)) throw new Error(`${b.name} did not parse`);
      return [b.name, portKind(parsed.starport)] as const;
    });
    expect(kinds.filter(([, k]) => k === 'starport').map(([n]) => n)).toEqual(['Terra']);
    expect(kinds.filter(([, k]) => k === 'spaceport')).toHaveLength(BODIES.length - 1);
  });

  it('calls the panel heading a Spaceport when it is one', () => {
    const luna = parseUpp('F20076C-F');
    if (isUppError(luna)) throw new Error('Luna did not parse');
    const terra = parseUpp('A867A69-F');
    if (isUppError(terra)) throw new Error('Terra did not parse');
    expect(describeUpp(luna).positions[0]!.name).toBe('Spaceport');
    expect(describeUpp(terra).positions[0]!.name).toBe('Starport');
    // And the prose behind it is the spaceport prose, not a starport class
    // that happens to share a letter with an ehex digit.
    expect(describeUpp(luna).positions[0]!.label).toContain('spaceport');
  });
});

describe('cepheus-1 Size against real radii', () => {
  it('lands within 10% for every body Traveller Size can represent', () => {
    // Two exceptions are listed rather than the tolerance being widened to hide
    // them, because *which* bodies miss is the interesting part.
    const wide = new Map([
      // Size steps are 1600 km of diameter, and Pluto falls between two of them.
      // The wiki calls it Size 1 (1600 km diameter); it is 2376 km across. This
      // is quantisation of a coarse rules scale, not an error in the table.
      ['Pluto', 35],
      // Same, the other way: Triton is 2707 km across and Size 2 is 3200 km.
      ['Triton', 20],
    ]);

    for (const body of BODIES) {
      const spec = interpretText(body.upp);
      const errorPct = Math.abs((spec.radiusKm - body.radiusKm) / body.radiusKm) * 100;
      expect(errorPct, `${body.name}: ${String(spec.radiusKm)} km vs ${String(body.radiusKm)} km`)
        .toBeLessThanOrEqual(wide.get(body.name) ?? 10);
    }
  });

  it('is not systematically biased high or low', () => {
    // A table that were uniformly 8% small would pass the check above while
    // being wrong in a way worth knowing about.
    let signed = 0;
    for (const body of BODIES) {
      signed += (interpretText(body.upp).radiusKm - body.radiusKm) / body.radiusKm;
    }
    expect(Math.abs(signed / BODIES.length)).toBeLessThan(0.05);
  });
});

describe('cepheus-1 crater density against real surfaces', () => {
  /**
   * Bodies whose crater density the interpreter gets wrong, and why.
   *
   * **Every one of them is resurfaced by internal activity** — cryovolcanism on
   * Triton and Pluto, tectonic grooving on Ganymede, whatever partly repaved
   * Titania. `interpret` computes density from atmosphere and standing liquid
   * only, and says so at the site: "the thing that really resurfaces a large
   * world is geological activity, which is Phase 3's parameter and is
   * deliberately not invented here."
   *
   * So the model's failures land exactly where the missing parameter goes, which
   * is a better outcome than failures scattered at random — it is evidence for
   * the Phase 3 parameter rather than against the Phase 1 formula. The list is
   * here so that a future `cepheus-2` claiming to fix this has something to
   * check itself against.
   */
  const RESURFACED_BY_ACTIVITY: Readonly<Record<string, string>> = {
    Ganymede: 'tectonic grooved terrain covers ~60% of it; we say 1.00',
    Titania: 'partly resurfaced; we say 1.00',
    Triton: 'cryovolcanic, among the youngest surfaces known; we say 0.95',
    Pluto: 'Sputnik Planitia is a crater-free ice sheet; we say 1.00',
  };

  it('is high where the record is saturated', () => {
    for (const body of BODIES.filter((b) => b.record === 'saturated')) {
      const { densityScale } = interpretText(body.upp).craters;
      expect(densityScale, `${body.name}: ${body.observed}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('is low where the surface has been resurfaced by atmosphere or ocean', () => {
    for (const body of BODIES.filter(
      (b) => b.record === 'sparse' && RESURFACED_BY_ACTIVITY[b.name] === undefined,
    )) {
      const { densityScale } = interpretText(body.upp).craters;
      expect(densityScale, `${body.name}: ${body.observed}`).toBeLessThanOrEqual(0.25);
    }
  });

  it('MISSES EXACTLY THE BODIES PHASE 3 WOULD EXPLAIN, and no others', () => {
    // The load-bearing one. If a body starts or stops being a miss, the list
    // above has become a stale claim about how good the ruleset is — and that
    // claim is cited in the argument for Phase 3 carrying a geological-activity
    // parameter at all.
    const misses = BODIES.filter((b) => {
      const { densityScale } = interpretText(b.upp).craters;
      const expected = b.record === 'saturated' ? 1 : b.record === 'moderate' ? 0.5 : 0.15;
      return Math.abs(densityScale - expected) > 0.35;
    }).map((b) => b.name);

    expect(misses.sort()).toEqual(Object.keys(RESURFACED_BY_ACTIVITY).sort());
  });
});
