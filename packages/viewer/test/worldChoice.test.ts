import { FIXTURES } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { chooseWorld, defaultWorld, fixtureIds } from '../src/world/choice.js';

const q = (search: string): URLSearchParams => new URLSearchParams(search);

describe('chooseWorld', () => {
  it('defaults to the Phase 0 rockball when nothing is asked for', () => {
    const choice = chooseWorld(q(''));
    expect(choice.fixtureId).toBeUndefined();
    expect(choice.world).toEqual(defaultWorld('42').world);
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
