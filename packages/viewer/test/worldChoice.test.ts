import {
  CEPHEUS_1,
  FIXTURES,
  type ParsedUpp,
  describeUpp,
  interpretText,
  isUppError,
  parseUpp,
} from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_UPP, chooseWorld, defaultWorld, fidelityFor, fixtureIds } from '../src/world/choice.js';

const q = (search: string): URLSearchParams => new URLSearchParams(search);

/** Parse, or fail the test with the parser's own message. */
function asUpp(text: string): ParsedUpp {
  const parsed = parseUpp(text);
  if (isUppError(parsed)) {
    throw new Error(parsed.message);
  }
  return parsed;
}

describe('chooseWorld', () => {
  it('defaults to an interpreted UPP, overriding nothing', () => {
    // WP12 replaced the Phase 0 stand-in here. The stand-in interpreted
    // `X200000-0` and then overrode radius, relief and fBm, which was harmless
    // while nothing on screen claimed otherwise and is not harmless beside an
    // input field showing a UPP. So the assertion is not merely "it is the
    // default world" — it is that the default world is what the interpreter
    // says about `DEFAULT_UPP`, with nothing on top.
    const choice = chooseWorld(q(''));
    expect(choice.fixtureId).toBeUndefined();
    expect(choice.world).toEqual(defaultWorld('42').world);
    expect(choice.world.spec).toEqual(interpretText(DEFAULT_UPP));
    expect(choice.upp?.canonical).toBe(DEFAULT_UPP);
  });

  it('hashes ?seed= into the default world', () => {
    const a = chooseWorld(q('?seed=alpha'));
    const b = chooseWorld(q('?seed=beta'));
    expect(a.world.seedHi === b.world.seedHi && a.world.seedLo === b.world.seedLo).toBe(false);
    expect(a.label).toContain('alpha');
  });

  it('resolves every fixture id', () => {
    expect(fixtureIds()).toHaveLength(FIXTURES.length);
    for (const fixture of FIXTURES) {
      const choice = chooseWorld(q(`?fixture=${fixture.id}`));
      expect(choice.fixtureId).toBe(fixture.id);
      expect(choice.label).toContain(fixture.id);
    }
  });

  it('hands back the fixture object itself, not a copy', () => {
    // The point of the whole feature: what gets flown must be what gets hashed.
    // A structural copy would satisfy `toEqual` while quietly permitting the
    // viewer to drift from the manifest, so this asserts identity.
    const fixture = FIXTURES[4]!;
    expect(chooseWorld(q(`?fixture=${fixture.id}`)).world).toBe(fixture.world);
  });

  it('distinguishes the fixtures from each other and from the default', () => {
    // If every fixture resolved to the same spec this file would still be green
    // above, and flying "all ten" would be flying one world ten times.
    const specs = FIXTURES.map((f) => JSON.stringify(chooseWorld(q(`?fixture=${f.id}`)).world));
    expect(new Set(specs).size).toBe(FIXTURES.length);
    expect(specs).not.toContain(JSON.stringify(defaultWorld('42').world));
  });

  it('rejects an unknown fixture, naming the ones that exist', () => {
    // Not a silent fallback to the default world: rendering something else on a
    // typo is how you convince yourself you have looked at a fixture when you
    // have not.
    expect(() => chooseWorld(q('?fixture=size7'))).toThrow(/unknown fixture 'size7'/);
    expect(() => chooseWorld(q('?fixture=size7'))).toThrow(/size7-temperate/);
  });

  it('refuses ?seed= together with ?fixture=', () => {
    const id = FIXTURES[0]!.id;
    expect(() => chooseWorld(q(`?fixture=${id}&seed=7`))).toThrow(/part of\s+the pinned fixture/);
  });

  it('spans the size range, which is why flying them is worth anything', () => {
    // Spike C's exit criteria were only ever exercised against one hardcoded
    // world. The reason to fly fixtures is that relief-to-radius varies across
    // them, which is where LOD and skirt maths can be wrong.
    //
    // The threshold was 10 when the specs were first written and the spread was
    // 40×. Retuning them against real solar-system bodies narrowed it to ~8×,
    // because real absolute relief is roughly flat at 14-28 km across this whole
    // radius range rather than falling away. A narrower spread is the realistic
    // one; it is recorded here so the next person to widen or narrow it has to
    // mean it.
    const ratios = FIXTURES.map(
      (f) => f.world.spec.terrainAmplitudeM / (f.world.spec.radiusKm * 1000),
    );
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeGreaterThan(5);
  });
});

describe('?upp=', () => {
  const at = (query: string): ReturnType<typeof chooseWorld> =>
    chooseWorld(new URLSearchParams(query));

  it('renders a world from the interpreter, overriding nothing', () => {
    // The point of the route. Every fixture overrides fBm and the default world
    // overrides radius, relief and fBm too, so this is the only path on which
    // cepheus-1's Size table is seen as it actually is.
    const choice = at('upp=X400000-0');
    const spec = interpretText('X400000-0');
    expect(choice.world.spec).toEqual(spec);
    expect(choice.fixtureId).toBeUndefined();
    expect(choice.label).toContain('X400000-0');
  });

  it('takes a seed, and different seeds give different worlds', () => {
    const a = at('upp=X400000-0&seed=alpha').world;
    const b = at('upp=X400000-0&seed=beta').world;
    expect([a.seedHi, a.seedLo]).not.toEqual([b.seedHi, b.seedLo]);
    // Same world, different instance of it: the spec must not vary with seed.
    expect(a.spec).toEqual(b.spec);
  });

  it('accepts the extended spaceport classes, so real system bodies fly', () => {
    // Luna and Callisto as the Traveller wiki writes them. This is what the
    // spaceport work was for; if the parser narrows again, this says so.
    expect(at('upp=F20076C-F').world.spec.radiusKm).toBe(1600);
    expect(at('upp=H30016A-F').world.spec.radiusKm).toBe(2400);
  });

  it('refuses Size 0 with the reason, not a broken planet', () => {
    // PRD §3: a belt is a system-level feature, not a body. The parser accepts
    // Size 0 and the interpreter is total over it, both deliberately — enforcing
    // product scope is the app's job and this is the app.
    expect(() => at('upp=X000000-0')).toThrow(/Size 0/);
    expect(() => at('upp=X000000-0')).toThrow(/belt/);
  });

  it('surfaces the parser message, which names the offending position', () => {
    expect(() => at('upp=Z867A69-8')).toThrow(/Position 1 \(Starport\)/);
    expect(() => at('upp=X8Z7A69-8')).toThrow(/Position 3 \(Atmosphere\)/);
  });

  it('refuses to be combined with ?fixture=', () => {
    // Two different worlds asked for at once. Silently picking one is how you
    // convince yourself you looked at something you did not.
    expect(() => at('upp=X400000-0&fixture=size4-luna')).toThrow(/cannot be combined/);
  });

  it('interprets under the ruleset named, and refuses one it does not have', () => {
    // R27 carries the ruleset id, so it is a promise to a URL somebody else is
    // holding. A build without `cepheus-2` must say so rather than quietly
    // reading the world under `cepheus-1`.
    expect(at('upp=X400000-0&ruleset=cepheus-1').ruleset?.id).toBe('cepheus-1');
    expect(() => at('upp=X400000-0&ruleset=cepheus-2')).toThrow(/unknown ruleset 'cepheus-2'/);
    expect(() => at('upp=X400000-0&ruleset=cepheus-2')).toThrow(/cepheus-1/);
  });

  it('refuses ?ruleset= together with ?fixture=', () => {
    // A fixture's spec is pinned rather than interpreted, so accepting a
    // ruleset id would imply a re-interpretation that does not happen.
    expect(() => at('fixture=size4-luna&ruleset=cepheus-1')).toThrow(/pinned rather than/);
  });

  it('names itself in the overlay stamp rather than claiming to be the default', () => {
    // The stamp is what ties a recorded observation to what was on screen.
    // Deriving it from `fixtureId` worked with two routes and mislabelled every
    // UPP world the moment there were three.
    //
    // From WP12 the no-parameter route names a UPP too, because it *is* one:
    // the old stand-in interpreted `X200000-0` and then overrode radius, relief
    // and fBm, which is not a thing the input field could honestly display.
    expect(at('upp=X400000-0').short).toBe('X400000-0');
    expect(at('fixture=size4-luna').short).toBe('size4-luna');
    expect(at('').short).toBe(DEFAULT_UPP);
  });
});

describe('reduced fidelity (PRD §7)', () => {
  const fidelityOf = (text: string): ReturnType<typeof fidelityFor> =>
    fidelityFor(asUpp(text), CEPHEUS_1);

  it('is silent for the worlds Phase 1 actually renders', () => {
    // Atmo 0-1, Hydro 0 — the phase's whole scope. A badge on these would be
    // a badge that is always on, which is a badge nobody reads.
    for (const upp of ['X100000-0', 'F20076C-F', 'X800000-0', 'XA10000-0']) {
      expect(fidelityOf(upp), upp).toEqual({ reduced: false, notes: [] });
    }
  });

  it('names the positions it cannot honour, and only those', () => {
    // Asserted as a set of positions rather than by regex on the prose. A badge
    // checked by matching its own sentence stops testing anything the first
    // time the sentence is edited — and the sentence is the part most likely to
    // be edited.
    const atmosphere = fidelityOf('C867A69-8');
    expect(atmosphere.reduced).toBe(true);
    expect(atmosphere.notes.map((n) => n.position)).toEqual(['Atmosphere', 'Hydrographics']);

    const dry = fidelityOf('X860000-0');
    expect(dry.notes.map((n) => n.position)).toEqual(['Atmosphere']);

    const wet = fidelityOf('X107000-0');
    expect(wet.notes.map((n) => n.position)).toEqual(['Hydrographics']);
  });

  it("reports the ruleset's own code and label, not a restatement", () => {
    // The badge says what `cepheus-1` calls the code. If it said something of
    // its own, the panel would disagree with the interpretation two rows below
    // it in the same panel.
    const [atmo] = fidelityOf('C867A69-8').notes;
    expect(atmo?.code).toBe('6');
    expect(atmo?.label).toBe(describeUpp(asUpp('C867A69-8'), CEPHEUS_1).positions[2]?.label);
  });

  it('says nothing about the four positions that are not physical', () => {
    // Population, Government, Law Level and Tech Level are Phase 6 additions,
    // not fidelity debts: the interpreter never reads them, so there is nothing
    // about the planet the renderer is being wrong about. A badge listing them
    // would be listing four positions that are fine.
    const busy = fidelityOf('A100AAA-F');
    expect(busy.reduced).toBe(false);
  });

  it('carries no note through the fixture route, which has no UPP to read', () => {
    expect(chooseWorld(q('?fixture=size4-luna')).fidelity).toEqual({ reduced: false, notes: [] });
  });

  it('reaches the choice, so the panel does not have to recompute it', () => {
    expect(chooseWorld(q('?upp=C867A69-8')).fidelity.reduced).toBe(true);
    expect(chooseWorld(q('?upp=X100000-0')).fidelity.reduced).toBe(false);
  });
});
