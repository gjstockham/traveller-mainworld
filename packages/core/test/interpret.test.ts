import { describe, expect, it } from 'vitest';

import expectations from './data/ruleset-expectations.json' with { type: 'json' };

import { STARPORT_CLASSES, UPP_POSITIONS, isUppError, parseUpp } from '../src/input/upp.js';
import type { ParsedUpp } from '../src/input/upp.js';
import { CEPHEUS_1, CEPHEUS_1_ID } from '../src/ruleset/cepheus1/index.js';
import { deepFrozenViolations } from '../src/ruleset/freeze.js';
import { interpret, interpretText } from '../src/ruleset/interpret.js';
import { DEFAULT_RULESET, RULESETS, requireRuleset, rulesetFor } from '../src/ruleset/index.js';
import type { Ruleset } from '../src/ruleset/ruleset.js';
import { rulesetHash, serialiseRuleset } from '../src/ruleset/ruleset.js';
import { leafPaths, serialiseSpec, specHash } from '../src/ruleset/serialise.js';
import type { PhysicalWorldSpec } from '../src/spec.js';

const EHEX = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Build a canonical UPP string from decoded values. */
function upp(
  starport: string,
  size: number,
  atmo: number,
  hydro: number,
  pop = 0,
  gov = 0,
  law = 0,
  tl = 0,
): string {
  const c = (v: number): string => EHEX[v]!;
  return `${starport}${c(size)}${c(atmo)}${c(hydro)}${c(pop)}${c(gov)}${c(law)}-${c(tl)}`;
}

function parsed(text: string): ParsedUpp {
  const result = parseUpp(text);
  if (isUppError(result)) throw new Error(`${text}: ${result.message}`);
  return result;
}

/** An unfrozen deep copy, so a test can mutate a table the ruleset froze. */
function mutableCopy(ruleset: Ruleset): Ruleset {
  return structuredClone(ruleset) as Ruleset;
}

/**
 * The next representable double above `x` — a real one-ulp step.
 *
 * Not `x + Number.EPSILON`, which is a **no-op** for any `|x| ≥ 2`: EPSILON is
 * the ulp at 1.0, and the ulp at 3.2 is twice that, so the addition rounds
 * straight back. The first draft of the column-coverage test below used it and
 * reported `craterTransitionAt1gKm` (3.2) as uncovered by the serialiser when
 * the real fault was that nothing had been changed. Worth the eight lines:
 * a mutation test whose mutation does nothing is a test that always passes.
 */
function nextUp(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

/** Ceilings of the three positions the interpreter reads, from the parser's own table. */
const MAX = Object.fromEntries(
  UPP_POSITIONS.filter((p) => p.max !== undefined).map((p) => [p.key, p.max!]),
) as Record<string, number>;

describe('interpret — total over every valid UPP', () => {
  // The three positions the interpreter actually reads, exhaustively, against
  // every port class — six starports and four spaceports, so
  // 10 × 11 × 16 × 11 = 19,360 worlds. The other four positions are covered by
  // the invariance test below rather than by multiplying this into billions.
  //
  // The count is written as the product rather than as a literal on purpose:
  // adding the spaceport classes moved it, and a literal would have had to be
  // hand-edited to a number nobody could check.
  const specs: PhysicalWorldSpec[] = [];
  for (const sp of STARPORT_CLASSES) {
    for (let size = 0; size <= MAX.size!; size++) {
      for (let atmo = 0; atmo <= MAX.atmosphere!; atmo++) {
        for (let hydro = 0; hydro <= MAX.hydrographics!; hydro++) {
          specs.push(interpret(parsed(upp(sp, size, atmo, hydro))));
        }
      }
    }
  }

  it('produces a spec for every one of them without throwing', () => {
    expect(specs).toHaveLength(
      STARPORT_CLASSES.length * (MAX.size! + 1) * (MAX.atmosphere! + 1) * (MAX.hydrographics! + 1),
    );
    // Sanity, so a table that silently lost a row cannot make the product agree
    // with itself while covering less.
    expect(specs.length).toBe(19_360);
  });

  it('never produces a non-finite number', () => {
    // The invariant the whole design has to hold: NaN bit patterns are
    // unspecified in JS and WASM alike, so one NaN on a spec WP14 hashes makes
    // that hash unreproducible. Infinity is not much better on a spec a human
    // reads. Size 0's zero gravity is the realistic route to both, which is
    // why `minSurfaceGravityG` exists.
    const bad: string[] = [];
    for (const spec of specs) {
      for (const line of serialiseSpec(spec).trim().split('\n')) {
        const [path, value] = line.split('=') as [string, string];
        if (/^-?[\d.]/.test(value) && !Number.isFinite(Number(value))) {
          bad.push(`${path}=${value}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps every bounded field inside its bounds', () => {
    // Violations are collected and asserted once, in the same shape as the
    // finiteness test above. That is not only tidier: this used to run six
    // `expect` calls per spec, and when the spaceport classes took the spec
    // count from 11,616 to 19,360 that became 116,000 assertions and the test
    // started timing out under load. A test that fails on a busy machine and
    // passes on an idle one is worse than a slow one — it teaches people to
    // re-run it.
    const bad: string[] = [];
    const check = (ok: boolean, what: string, value: number): void => {
      if (!ok && bad.length < 10) bad.push(`${what} = ${String(value)}`);
    };

    for (const spec of specs) {
      check(spec.radiusKm > 0, 'radiusKm', spec.radiusKm);
      check(spec.terrainAmplitudeM > 0, 'terrainAmplitudeM', spec.terrainAmplitudeM);
      check(
        spec.craters.transitionDiameterKm > 0,
        'craters.transitionDiameterKm',
        spec.craters.transitionDiameterKm,
      );
      for (const [name, fraction] of [
        ['hydrographicCoverage', spec.hydrographicCoverage],
        ['hints.iceLikelihood', spec.hints.iceLikelihood],
        ['craters.densityScale', spec.craters.densityScale],
        ['craters.regolithMaturity', spec.craters.regolithMaturity],
      ] as const) {
        check(fraction >= 0 && fraction <= 1, name, fraction);
      }
    }
    expect(bad).toEqual([]);
  });

  it('is pure: the same UPP interprets identically every time', () => {
    const once = interpretText('C867A69-8');
    const twice = interpretText('C867A69-8');
    expect(specHash(twice)).toBe(specHash(once));
    expect(twice).toEqual(once);
  });
});

describe('interpret — what it deliberately ignores', () => {
  it('does not vary with Starport, Population, Government, Law Level or Tech Level', () => {
    // A spec that changed because a law level changed would be a planet whose
    // terrain moved when its politics did. These four positions drive
    // settlement placement from Phase 6, and nothing physical before then.
    const base = specHash(interpret(parsed(upp('X', 8, 6, 7))));
    for (const sp of STARPORT_CLASSES) {
      for (let pop = 0; pop <= MAX.population!; pop++) {
        for (let gov = 0; gov <= MAX.government!; gov++) {
          expect(specHash(interpret(parsed(upp(sp, 8, 6, 7, pop, gov, 0, 0))))).toBe(base);
        }
      }
    }
    for (let law = 0; law <= MAX.lawLevel!; law++) {
      for (let tl = 0; tl <= MAX.techLevel!; tl++) {
        expect(specHash(interpret(parsed(upp('C', 8, 6, 7, 0, 0, law, tl))))).toBe(base);
      }
    }
  });

  it('varies with each of Size, Atmosphere and Hydrographics', () => {
    // The mirror of the test above, and the reason it means anything: if
    // `interpret` ignored everything, the invariance test would pass trivially.
    const base = specHash(interpret(parsed(upp('C', 4, 4, 4))));
    expect(specHash(interpret(parsed(upp('C', 5, 4, 4))))).not.toBe(base);
    expect(specHash(interpret(parsed(upp('C', 4, 5, 4))))).not.toBe(base);
    expect(specHash(interpret(parsed(upp('C', 4, 4, 5))))).not.toBe(base);
  });
});

describe('interpret — the Cepheus tables read correctly', () => {
  it('reads Size as 800 km of radius per point', () => {
    for (let size = 1; size <= 10; size++) {
      expect(interpret(parsed(upp('X', size, 0, 0))).radiusKm).toBe(size * 800);
    }
  });

  it('reads Hydrographics as code × 10%', () => {
    for (let hydro = 0; hydro <= 10; hydro++) {
      expect(interpret(parsed(upp('X', 8, 6, hydro))).hydrographicCoverage).toBeCloseTo(
        hydro / 10,
        12,
      );
    }
  });

  it('puts Earth where Earth is', () => {
    // C867A69-8 is the PRD's own example, and Size 8 is the code these tables
    // are calibrated against. Three independent anchors have to land at once.
    const earth = interpretText('C867A69-8');
    expect(earth.radiusKm).toBe(6400);
    expect(earth.surfaceGravityG).toBe(1);
    expect(earth.hints.terrainRoughness).toBeCloseTo(0.0031, 4);
    expect(earth.craters.transitionDiameterKm).toBeCloseTo(3.2, 6);
    expect(earth.atmosphere.pressureBand).toBe('standard');
    expect(earth.atmosphere.composition).toBe('standard');
  });

  it('scales the crater transition diameter inversely with gravity', () => {
    // Luna's real simple/complex transition is ~19 km, Mars's ~7 km. A Size 2
    // world (0.15g) and a Size 4 world (0.35g) should bracket those.
    const lunaish = interpretText('X200000-0').craters.transitionDiameterKm;
    const marsish = interpretText('X400000-0').craters.transitionDiameterKm;
    expect(lunaish).toBeGreaterThan(marsish);
    expect(lunaish).toBeCloseTo(21.3, 1);
    expect(marsish).toBeCloseTo(9.1, 1);
  });

  it('saturates craters on an airless dry world and erases them on a wet one', () => {
    expect(interpretText('X100000-0').craters.densityScale).toBe(1);
    expect(interpretText('X800000-0').craters.densityScale).toBe(1);
    // Hydro A leaves nowhere for a crater to be.
    expect(interpretText('A8FA000-0').craters.densityScale).toBe(0);
    // Earth: an atmosphere and 70% ocean between them keep almost nothing.
    expect(interpretText('C867A69-8').craters.densityScale).toBeLessThan(0.1);
  });

  it('gives a belt a finite spec rather than refusing one', () => {
    // PRD §3 makes Size 0 a permanent non-goal, but the refusal is the app's
    // job — the parser accepts it deliberately, and an interpreter that threw
    // would push product scope into a pure function.
    const belt = interpretText('X000000-0');
    expect(belt.surfaceGravityG).toBe(0);
    expect(Number.isFinite(belt.craters.transitionDiameterKm)).toBe(true);
  });

  it('lifts a cold world with standing liquid to temperate', () => {
    // The one climate inference here that is genuinely sound: surface liquid
    // means liquid-water temperatures.
    expect(interpretText('X850000-0').hints.temperatureBand).toBe('cold');
    expect(interpretText('X855000-0').hints.temperatureBand).toBe('temperate');
    // ...and it does not lower a hot world, which can still have oceans.
    expect(interpretText('X8A5000-0').hints.temperatureBand).toBe('hot');
  });

  it('gives an airless dry world no ice and a trace-atmosphere one a little', () => {
    // Luna and Mercury do carry ice, in permanently shadowed craters.
    expect(interpretText('X800000-0').hints.iceLikelihood).toBe(0);
    expect(interpretText('X810000-0').hints.iceLikelihood).toBeGreaterThan(0);
  });
});

describe('the committed expectation table', () => {
  const committed = expectations[CEPHEUS_1_ID];

  it('covers every ruleset this build ships', () => {
    for (const ruleset of RULESETS) {
      expect(Object.keys(expectations)).toContain(ruleset.id);
    }
  });

  it("matches cepheus-1's table digest", () => {
    expect(rulesetHash(CEPHEUS_1)).toBe(committed.rulesetHash);
  });

  it.each(committed.upps.map((e) => [e.upp, e] as const))(
    'reproduces the committed spec for %s',
    (_upp, entry) => {
      const spec = interpretText(entry.upp);
      expect(spec).toEqual(entry.spec);
      expect(specHash(spec)).toBe(entry.specHash);
    },
  );

  it('spans every Size code exactly once', () => {
    // One UPP per Size code is a property worth stating: it is what makes
    // "the committed table covers the interpreter" a claim rather than a hope.
    const sizes = committed.upps.map((e) => parsed(e.upp).size).sort((a, b) => a - b);
    expect(sizes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('includes every structurally distinct Atmosphere case', () => {
    // Vacuum, trace, the three hazard classes, the two altitude-limited codes
    // and the unusual one. The ordinary graded codes are covered exhaustively
    // by the totality suite above; these are the ones with their own shape.
    const atmos = new Set(committed.upps.map((e) => parsed(e.upp).atmosphere));
    for (const code of [0, 1, 10, 11, 12, 13, 14, 15]) {
      expect(atmos, `Atmosphere ${String(code)} is not in the committed table`).toContain(code);
    }
  });
});

describe('a table edit is caught', () => {
  // Phase 1 plan §4 acceptance: "a deliberate table edit fails the spec-hash
  // check". These run the edit rather than describing it, so the claim stays
  // true after the next refactor rather than only on the day it was written.

  it('moves the ruleset digest when a Size radius changes', () => {
    const edited = mutableCopy(CEPHEUS_1);
    (edited.tables.size[8] as { radiusKm: number }).radiusKm = 6401;
    expect(rulesetHash(edited)).not.toBe(rulesetHash(CEPHEUS_1));
  });

  it('moves the affected spec hashes, and only those', () => {
    const edited = mutableCopy(CEPHEUS_1);
    (edited.tables.atmosphere[6] as { craterPreservation: number }).craterPreservation = 0.21;

    // Every UPP with Atmosphere 6 moves...
    expect(specHash(interpretText('C867A69-8', edited))).not.toBe(
      specHash(interpretText('C867A69-8')),
    );
    // ...and no UPP without it does. A digest that moved for everything would
    // be no more informative than a timestamp.
    expect(specHash(interpretText('X100000-0', edited))).toBe(specHash(interpretText('X100000-0')));
  });

  it('moves the digest for a one-ulp change to any numeric column', () => {
    // The columns are read by different code paths; a serialisation that
    // silently dropped one would still pass the two tests above.
    /** Nudge one numeric field by one ulp, and assert it really moved. */
    const bump = (row: unknown, key: string): void => {
      const target = row as Record<string, number>;
      const before = target[key]!;
      target[key] = nextUp(before);
      expect(target[key], `${key} did not move`).not.toBe(before);
    };

    const columns: Array<[string, (r: Ruleset) => void]> = [
      ['size.radiusKm', (r) => bump(r.tables.size[3], 'radiusKm')],
      ['size.surfaceGravityG', (r) => bump(r.tables.size[3], 'surfaceGravityG')],
      ['size.terrainAmplitudeM', (r) => bump(r.tables.size[3], 'terrainAmplitudeM')],
      ['size.fbmFrequency', (r) => bump(r.tables.size[3], 'fbmFrequency')],
      ['size.fbmOctaves', (r) => ((r.tables.size[3] as { fbmOctaves: number }).fbmOctaves += 1)],
      ['atmosphere.pressureBar', (r) => bump(r.tables.atmosphere[6], 'pressureBar')],
      ['atmosphere.craterPreservation', (r) => bump(r.tables.atmosphere[6], 'craterPreservation')],
      ['atmosphere.composition', (r) => ((r.tables.atmosphere[6] as { composition: string }).composition = 'tainted')],
      ['atmosphere.pressureBand', (r) => ((r.tables.atmosphere[6] as { pressureBand: string }).pressureBand = 'dense')],
      ['atmosphere.baseTemperature', (r) => ((r.tables.atmosphere[6] as { baseTemperature: string }).baseTemperature = 'hot')],
      ['hydrographics.coverage', (r) => bump(r.tables.hydrographics[5], 'coverage')],
      ['craterTransitionAt1gKm', (r) => bump(r.tables, 'craterTransitionAt1gKm')],
      ['minSurfaceGravityG', (r) => bump(r.tables, 'minSurfaceGravityG')],
    ];

    const base = rulesetHash(CEPHEUS_1);
    for (const [name, mutate] of columns) {
      const edited = mutableCopy(CEPHEUS_1);
      mutate(edited);
      expect(rulesetHash(edited), `${name} is not covered by serialiseRuleset`).not.toBe(base);
    }
  });

  it('does not move the digest for a prose typo', () => {
    // Prose is outside the hash on purpose: fixing a sentence changes no
    // generated pixel and must not oblige anyone to mint cepheus-2. The
    // obligation prose does carry is coverage, which describe.test.ts asserts.
    const edited = mutableCopy(CEPHEUS_1);
    (edited.tables.prose.size[8] as { text: string }).text = 'Corrected sentence.';
    expect(rulesetHash(edited)).toBe(rulesetHash(CEPHEUS_1));
  });
});

describe('cepheus-1 is frozen', () => {
  it('is deep-frozen, not merely frozen at the top', () => {
    // Object.freeze is shallow, so freezing the ruleset object alone would
    // leave every table inside it writable — and a table mutated at runtime is
    // the one failure this design cannot detect, because the id would still
    // say cepheus-1 while the numbers behind it had moved.
    expect(deepFrozenViolations(CEPHEUS_1)).toEqual([]);
  });

  it('rejects a write to a table row', () => {
    expect(() => {
      (CEPHEUS_1.tables.size[8] as { radiusKm: number }).radiusKm = 1;
    }).toThrow(TypeError);
    expect(CEPHEUS_1.tables.size[8]!.radiusKm).toBe(6400);
  });

  it('names the unfrozen paths when something is not frozen', () => {
    // The discrimination check for the assertion above: an all-frozen graph
    // and a broken detector look identical from the passing side.
    const thawed = mutableCopy(CEPHEUS_1);
    expect(deepFrozenViolations(thawed)).toContain('$.tables.size[8]');
  });
});

describe('the ruleset registry', () => {
  it('resolves cepheus-1 and defaults to it', () => {
    expect(rulesetFor(CEPHEUS_1_ID)).toBe(CEPHEUS_1);
    expect(DEFAULT_RULESET).toBe(CEPHEUS_1);
  });

  it('fails loudly on an unknown id rather than falling back', () => {
    // A URL naming cepheus-2 opened in a build that only has cepheus-1
    // describes a world this build cannot produce. Quietly producing a
    // different one is the failure share URLs exist to prevent.
    expect(rulesetFor('cepheus-2')).toBeUndefined();
    expect(() => requireRuleset('cepheus-2')).toThrow(/unknown ruleset 'cepheus-2'/);
    expect(() => requireRuleset('cepheus-2')).toThrow(/cepheus-1/);
  });

  it('has no duplicate ids', () => {
    expect(new Set(RULESETS.map((r) => r.id)).size).toBe(RULESETS.length);
  });
});

describe('table ordering', () => {
  it('refuses to interpret against a table whose rows are out of code order', () => {
    // `rowFor` indexes rather than searches, so a misordered table would
    // otherwise return a real row for the wrong code — a silently wrong world
    // rather than an error.
    const edited = mutableCopy(CEPHEUS_1);
    const rows = edited.tables.size as unknown as { code: number }[];
    [rows[3], rows[4]] = [rows[4]!, rows[3]!];
    expect(() => interpretText('X300000-0', edited)).toThrow(/not indexed by code/);
  });
});

describe('interpretText', () => {
  it('throws on a malformed literal rather than returning a wrong planet', () => {
    expect(() => interpretText('867A')).toThrow(/not a UPP/);
    expect(() => interpretText('Z867A69-8')).toThrow(/Starport/);
  });
});

describe('serialiseSpec covers the whole spec', () => {
  it('mentions every leaf of PhysicalWorldSpec', () => {
    // The cost of writing the field list out by hand is that a field added to
    // the interface and not added to the serialiser is hashed as though it did
    // not exist. This is where that cost gets paid.
    const spec = interpretText('C867A69-8');
    const serialised = serialiseSpec(spec);
    const missing = leafPaths(spec).filter((path) => !serialised.includes(`${path}=`));
    expect(missing).toEqual([]);
  });

  it('is ASCII, line-oriented, and ends with a newline', () => {
    const text = serialiseSpec(interpretText('C867A69-8'));
    expect(text.endsWith('\n')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });

  it('serialises the ruleset tables as ASCII too', () => {
    const text = serialiseRuleset(CEPHEUS_1);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });
});
