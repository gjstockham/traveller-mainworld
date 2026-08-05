import { describe, expect, it } from 'vitest';

import {
  STARPORT_CLASSES,
  UPP_POSITIONS,
  formatUpp,
  isUppError,
  parseUpp,
  type ParsedUpp,
  type UppErrorCode,
} from '../src/input/upp.js';

/** Parse and assert success, returning the parsed value. */
function accept(text: string): ParsedUpp {
  const result = parseUpp(text);
  if (isUppError(result)) {
    throw new Error(`expected '${text}' to parse, got: ${result.message}`);
  }
  return result;
}

/** Parse and assert failure, returning the error. */
function reject(text: string) {
  const result = parseUpp(text);
  if (!isUppError(result)) {
    throw new Error(`expected '${text}' to be rejected, but it parsed`);
  }
  return result;
}

describe('parseUpp — accepted forms', () => {
  const cases: ReadonlyArray<[label: string, input: string]> = [
    ['canonical', 'C867A69-8'],
    ['lowercase', 'c867a69-8'],
    ['mixed case', 'c867A69-8'],
    ['leading whitespace', '   C867A69-8'],
    ['trailing whitespace', 'C867A69-8   '],
    ['whitespace both ends', '\t C867A69-8 \n'],
  ];

  it.each(cases)('accepts %s', (_label, input) => {
    expect(accept(input).canonical).toBe('C867A69-8');
  });

  it('decodes every position', () => {
    expect(accept('C867A69-8')).toMatchObject({
      starport: 'C',
      size: 8,
      atmosphere: 6,
      hydrographics: 7,
      population: 10,
      government: 6,
      lawLevel: 9,
      techLevel: 8,
    });
  });

  it('preserves the input verbatim, untrimmed and uncased', () => {
    const raw = '  c867a69-8 ';
    expect(accept(raw).raw).toBe(raw);
  });

  it('accepts every starport class', () => {
    for (const cls of STARPORT_CLASSES) {
      expect(accept(`${cls}867A69-8`).starport).toBe(cls);
    }
  });

  it('accepts Size 0, leaving the belt refusal to the app', () => {
    // PRD §3 makes belts a non-goal, but it is the app that says so. A parser
    // that refused Size 0 would be enforcing product scope, and would have to
    // be unpicked if belts ever become a separate generator.
    const parsed = accept('C067A69-8');
    expect(parsed.size).toBe(0);
  });

  it('accepts the all-zero and all-maximum extremes', () => {
    expect(accept('X000000-0')).toMatchObject({ size: 0, atmosphere: 0, techLevel: 0 });
    expect(accept('AAFACFF-F')).toMatchObject({
      size: 10,
      atmosphere: 15,
      hydrographics: 10,
      population: 12,
      government: 15,
      lawLevel: 15,
      techLevel: 15,
    });
  });
});

describe('parseUpp — rejections name the offending position', () => {
  const cases: ReadonlyArray<{
    label: string;
    input: string;
    code: UppErrorCode;
    position: number;
    /** Fragments that must all appear in the message. */
    says: readonly string[];
  }> = [
    {
      label: 'empty',
      input: '',
      code: 'empty',
      position: 0,
      says: ['Enter a UPP', 'C867A69-8'],
    },
    {
      label: 'whitespace only',
      input: '   ',
      code: 'empty',
      position: 0,
      says: ['Enter a UPP'],
    },
    {
      label: 'interior space',
      input: 'C867 A69-8',
      code: 'interior-whitespace',
      position: 0,
      says: ['space at character 5'],
    },
    {
      label: 'two hyphens',
      input: 'C86-7A69-8',
      code: 'extra-hyphen',
      position: 0,
      says: ['one hyphen', 'character 9'],
    },
    {
      label: 'no hyphen',
      input: 'C867A698',
      code: 'missing-hyphen',
      position: 0,
      says: ['hyphen separates the Tech Level code', 'C867A69-8'],
    },
    {
      label: 'hyphen in the wrong place',
      input: 'C867-A698',
      code: 'misplaced-hyphen',
      position: 0,
      says: ['character 8, not character 5', 'C867A69-8'],
    },
    {
      label: 'too short',
      input: 'C86',
      code: 'wrong-length',
      position: 0,
      says: ['8 codes', 'this has 3'],
    },
    {
      label: 'too long',
      input: 'C867A699-88',
      code: 'wrong-length',
      position: 0,
      says: ['this has 10'],
    },
    {
      label: 'starport omitted',
      input: '867A69-8',
      code: 'wrong-length',
      position: 0,
      says: ['omit the starport class'],
    },
    {
      label: 'tech level omitted',
      input: 'C867A69-',
      code: 'wrong-length',
      position: 0,
      says: ['Tech Level code after the hyphen is missing'],
    },
    {
      label: 'unknown starport class',
      input: 'Z867A69-8',
      code: 'bad-starport',
      position: 1,
      says: [
        'Position 1 (Starport)',
        "'Z' is not a starport or spaceport class",
        'starport (A, B, C, D, E, X)',
        'spaceport (F, G, H, Y)',
      ],
    },
    {
      label: 'digit as starport class',
      input: '8867A69-8',
      code: 'bad-starport',
      position: 1,
      says: ['Position 1 (Starport)', "'8'"],
    },
    {
      label: 'letter O for zero',
      input: 'C8O7A69-8',
      code: 'excluded-letter',
      position: 3,
      says: ['Position 3 (Atmosphere)', 'leave out I and O', "Did you mean '0'?"],
    },
    {
      label: 'letter I for one',
      input: 'C86IA69-8',
      code: 'excluded-letter',
      position: 4,
      says: ['Position 4 (Hydrographics)', "Did you mean '1'?"],
    },
    {
      label: 'punctuation',
      input: 'C8#7A69-8',
      code: 'not-a-code',
      position: 3,
      says: ['Position 3 (Atmosphere)', "'#' is not a code", 'Expected 0–F'],
    },
    {
      label: 'size above A',
      input: 'CB67A69-8',
      code: 'out-of-range',
      position: 2,
      says: ['Position 2 (Size)', "'B' is 11", 'maximum of A (10)'],
    },
    {
      label: 'hydrographics above A',
      input: 'C86EA69-8',
      code: 'out-of-range',
      position: 4,
      says: ['Position 4 (Hydrographics)', "'E' is 14", 'maximum of A (10)'],
    },
    {
      label: 'population above C',
      input: 'C867D69-8',
      code: 'out-of-range',
      position: 5,
      says: ['Position 5 (Population)', "'D' is 13", 'maximum of C (12)'],
    },
    {
      label: 'tech level above F',
      input: 'C867A69-G',
      code: 'out-of-range',
      position: 8,
      says: ['Position 8 (Tech Level)', "'G' is 16", 'maximum of F (15)'],
    },
    {
      label: 'law level above F',
      input: 'C867A6Z-8',
      code: 'out-of-range',
      position: 7,
      says: ['Position 7 (Law Level)', "'Z' is 33"],
    },
  ];

  it.each(cases)('$label', ({ input, code, position, says }) => {
    const error = reject(input);
    expect(error.code).toBe(code);
    expect(error.position).toBe(position);
    for (const fragment of says) {
      expect(error.message).toContain(fragment);
    }
  });

  it('points at the earliest mistake when there are several', () => {
    // Bad size *and* bad hydrographics. Reporting the second would send the
    // user to fix a character that is not the first thing wrong.
    expect(reject('CB6EA69-8').position).toBe(2);
  });

  it('reports the offending index, not just the position', () => {
    // Position 8 sits at index 8, because the hyphen occupies index 7. Getting
    // this wrong would underline the hyphen in the viewer's inline error.
    expect(reject('C867A69-G').index).toBe(8);
    expect(reject('C867A6Z-8').index).toBe(6);
  });

  it('gives every distinct fault a distinct message', () => {
    // The failure this whole error type exists to prevent is every rejection
    // collapsing to "invalid UPP". Two inputs may share a message only if they
    // are the same fault at the same position; anything else means a message
    // has stopped discriminating. Catches the collapse structurally, and keeps
    // catching it as cases are added.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const c of cases) {
      const message = reject(c.input).message;
      const fault = `${c.code}:${String(c.position)}`;
      const prior = seen.get(message);
      if (prior !== undefined && prior !== fault) {
        collisions.push(`${fault} and ${prior} both say: ${message}`);
      }
      seen.set(message, fault);
    }
    expect(collisions).toEqual([]);
  });

  it('never says merely "invalid"', () => {
    for (const c of cases) {
      const message = reject(c.input).message;
      expect(message.length).toBeGreaterThan(20);
      expect(message.toLowerCase()).not.toMatch(/^invalid\b/);
    }
  });
});

describe('parseUpp — round trip', () => {
  it('format(parse(s)) is the canonical spelling', () => {
    for (const input of ['C867A69-8', 'c867a69-8', ' X000000-0 ', 'AAFACFF-F', 'B123456-7']) {
      const parsed = accept(input);
      expect(formatUpp(parsed)).toBe(parsed.canonical);
    }
  });

  it('re-parses its own output to an equal value', () => {
    const parsed = accept('  e9a4c02-b  ');
    const reparsed = accept(formatUpp(parsed));
    expect({ ...reparsed, raw: parsed.raw }).toEqual(parsed);
  });

  it('round-trips every value at every position', () => {
    for (const pos of UPP_POSITIONS) {
      if (pos.key === 'starport') continue;
      for (let value = 0; value <= (pos.max ?? 0); value++) {
        const chars = 'C867A69-8'.split('');
        chars[pos.index] = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[value] as string;
        const text = chars.join('');
        const parsed = accept(text);
        expect(parsed[pos.key]).toBe(value);
        expect(formatUpp(parsed)).toBe(text);
      }
    }
  });
});

describe('parseUpp — sweeps', () => {
  const EHEX = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  it('parses every Size × Atmosphere × Hydrographics combination', () => {
    // The three digits the MVP actually consumes (PRD §5), swept exhaustively:
    // 11 × 16 × 11 = 1936 cases. The full eight-position product is 6 × 11 × 16
    // × 11 × 13 × 16 × 16 × 16 ≈ 6.2 × 10⁸, which is not a unit test — the
    // per-position sweep above plus the sample below cover it honestly.
    let count = 0;
    for (let size = 0; size <= 10; size++) {
      for (let atmo = 0; atmo <= 15; atmo++) {
        for (let hydro = 0; hydro <= 10; hydro++) {
          const text = `C${EHEX[size]!}${EHEX[atmo]!}${EHEX[hydro]!}A69-8`;
          const parsed = accept(text);
          expect(parsed.size).toBe(size);
          expect(parsed.atmosphere).toBe(atmo);
          expect(parsed.hydrographics).toBe(hydro);
          count++;
        }
      }
    }
    expect(count).toBe(11 * 16 * 11);
  });

  it('parses a deterministic sample of the full eight-position space', () => {
    // Catches any cross-position interaction the independent sweeps would miss.
    // A fixed LCG rather than Math.random so a failure is reproducible.
    let state = 0x2545f491;
    const next = (n: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % n;
    };
    const maxes = [10, 15, 10, 12, 15, 15, 15];

    for (let i = 0; i < 20000; i++) {
      const starport = STARPORT_CLASSES[next(STARPORT_CLASSES.length)]!;
      const values = maxes.map((max) => next(max + 1));
      const text =
        starport + values.slice(0, 6).map((v) => EHEX[v]!).join('') + '-' + EHEX[values[6]!]!;
      const parsed = accept(text);
      expect(formatUpp(parsed)).toBe(text);
    }
  });

  it('rejects every out-of-range value at every position', () => {
    for (const pos of UPP_POSITIONS) {
      if (pos.key === 'starport') continue;
      for (let value = (pos.max ?? 0) + 1; value < EHEX.length; value++) {
        const chars = 'C867A69-8'.split('');
        chars[pos.index] = EHEX[value] as string;
        const error = reject(chars.join(''));
        expect(error.code).toBe('out-of-range');
        expect(error.position).toBe(pos.position);
      }
    }
  });
});

describe('parseUpp — totality', () => {
  it('returns a typed error rather than throwing, for anything at all', () => {
    const nasty = [
      '',
      ' ',
      '\0',
      '-',
      '--------',
      '---------',
      'C867A69-8C867A69-8',
      'ß867A69-8', // uppercases to two characters; must not shift the indices
      'ﬁ867A69-8',
      '🌍867A69-8', // a surrogate pair: two code units, one glyph
      'C867A69-🌍',
      'İ867A69-8',
      'C867A69–8', // en dash, not a hyphen
      'C867A69­-8', // soft hyphen
      '\uD800867A69-8', // lone surrogate
      'C867A69-8﻿',
      'x'.repeat(10000),
      '0'.repeat(9),
      'null',
      'undefined',
      '[object Object]',
      '{"upp":"C867A69-8"}',
      'C867A69-8\n\nC867A69-8',
    ];

    for (const input of nasty) {
      const result = parseUpp(input);
      expect(typeof result.ok).toBe('boolean');
      if (isUppError(result)) {
        expect(result.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps indices honest across a character that uppercases to two', () => {
    // 'ß'.toUpperCase() is 'SS'. Folding the whole string would make this ten
    // characters and report the wrong position; ASCII-only folding does not.
    const error = reject('Cß67A69-8');
    expect(error.position).toBe(2);
    expect(error.index).toBe(1);
  });

  it('survives every prefix and suffix of a valid UPP', () => {
    const valid = 'C867A69-8';
    for (let i = 0; i <= valid.length; i++) {
      expect(() => parseUpp(valid.slice(0, i))).not.toThrow();
      expect(() => parseUpp(valid.slice(i))).not.toThrow();
    }
  });
});
