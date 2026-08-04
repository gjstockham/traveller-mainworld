/**
 * UPP parsing (PRD R1).
 *
 * This file decodes *characters into numbers*. It holds no rules knowledge: it
 * does not know that Size 8 means a 12,800 km diameter, or that Atmo 0 means
 * vacuum, or that a belt is not a body. All of that belongs to the ruleset
 * interpreter (WP9, PRD §6.2), which consumes a `ParsedUpp` and produces a
 * `PhysicalWorldSpec`. If a Cepheus *fact* ever appears in here, it is in the
 * wrong file.
 *
 * The line between the two is the per-position ranges below. Knowing that
 * Hydrographics stops at `A` is part of knowing how the string is *encoded* —
 * without it a typed `E` would clamp silently downstream, which is worse than
 * an error. Knowing what `A` then *means* is not, and is not here.
 *
 * ## The accepted form
 *
 * Exactly one shape, `C867A69-8`: a starport class, six codes, a hyphen, and
 * the Tech Level code. Case is folded and surrounding whitespace is trimmed;
 * nothing else varies. PRD R1 originally made the hyphen and the starport
 * optional, and the Phase 1 plan additionally allowed a bare Size/Atmo/Hydro
 * form. Both were withdrawn deliberately: every position is intended to drive
 * generation in later phases, so an input path that lets one go missing is a
 * migration waiting to happen once share URLs exist. R1 was amended to match,
 * rather than left contradicting this file.
 *
 * The MVP consumes only Size, Atmosphere and Hydrographics (PRD §5), but every
 * position is decoded and the input is preserved verbatim, because a parser
 * that discards Starport, Pop, Gov, Law and TL is a parser that gets rewritten.
 */

/** A starport class. Categorical, unlike every other position. */
export type StarportClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'X';

/**
 * The valid starport classes.
 *
 * The one position PRD §6.1 gives no range for, validated here anyway: a typed
 * `Z` is exactly the catchable typo the rest of this file exists to catch.
 *
 * **WP9 decided this stays here** — the set of starport classes is an
 * *encoding* fact, not a ruleset fact. Three reasons, in order of weight:
 *
 * 1. **Consistency with every other position.** `UPP_POSITIONS` already
 *    hardcodes that Hydrographics stops at `A` and Government at `F`. Those
 *    ceilings are Cepheus facts in exactly the same sense, and the header
 *    above already draws the line where this file draws it: knowing the
 *    *symbols* is knowing the encoding, knowing what they *mean* is not.
 *    Moving one position across that line and leaving seven would make the
 *    boundary arbitrary.
 * 2. **`parseUpp` takes no ruleset, and should not.** Parsing has to work
 *    before a ruleset is chosen — the viewer validates as the user types, and
 *    `?ruleset=` is a separate URL parameter that may name a ruleset this
 *    build does not have. A parser that needed a ruleset would either take one
 *    or reach for a default, and the second is the silent-wrong-answer path.
 * 3. **A ruleset with a different set is a different encoding.** If house
 *    rules add an `F` starport, the string `F867A69-8` is a string this parser
 *    should learn to read. That is a parser change, which is the honest place
 *    for it, and the WP8 comment's "range check against the ruleset's set"
 *    would have hidden it in a data table.
 *
 * The ruleset's obligation runs the other way: `cepheus-1` must have prose for
 * every class listed here, and `describe.test.ts` asserts exactly that, so the
 * two cannot drift apart.
 */
export const STARPORT_CLASSES: readonly StarportClass[] = ['A', 'B', 'C', 'D', 'E', 'X'];

/**
 * Traveller extended hex, which omits `I` and `O` so they cannot be misread as
 * `1` and `0`. Index is the value: `A` is 10, `F` is 15, `Z` is 33.
 *
 * Decoded past `F` even though no position here reaches it, so that an
 * out-of-range `G` can be reported as "is 16, out of range" rather than as an
 * unrecognised character — a materially more useful message, and one that
 * survives a later phase raising a ceiling.
 */
const EHEX = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The field names of a `ParsedUpp`, excluding the starport. */
export type UppCodeKey =
  | 'size'
  | 'atmosphere'
  | 'hydrographics'
  | 'population'
  | 'government'
  | 'lawLevel'
  | 'techLevel';

/** One position's decoding metadata: where it sits, what it is called, its ceiling. */
export interface UppPosition {
  /** 1-based UPP position, as used in error messages. */
  readonly position: number;
  /** 0-based index into the canonical nine-character string. */
  readonly index: number;
  /** Display name, for error messages and the R21 info panel. */
  readonly name: string;
  /** The `ParsedUpp` field, or `'starport'` for position 1. */
  readonly key: UppCodeKey | 'starport';
  /** Highest permitted value, or `undefined` for the categorical starport. */
  readonly max: number | undefined;
}

/**
 * Every position, in order, with its ceiling.
 *
 * Exported so the info panel and the interpreter iterate one table rather than
 * each hardcoding the same eight names. Note index 8, not 7, for Tech Level:
 * the hyphen occupies index 7.
 */
export const UPP_POSITIONS: readonly UppPosition[] = [
  { position: 1, index: 0, name: 'Starport', key: 'starport', max: undefined },
  { position: 2, index: 1, name: 'Size', key: 'size', max: 10 },
  { position: 3, index: 2, name: 'Atmosphere', key: 'atmosphere', max: 15 },
  { position: 4, index: 3, name: 'Hydrographics', key: 'hydrographics', max: 10 },
  { position: 5, index: 4, name: 'Population', key: 'population', max: 12 },
  { position: 6, index: 5, name: 'Government', key: 'government', max: 15 },
  { position: 7, index: 6, name: 'Law Level', key: 'lawLevel', max: 15 },
  { position: 8, index: 8, name: 'Tech Level', key: 'techLevel', max: 15 },
];

/** Index of the hyphen in the canonical form, and therefore the canonical length. */
const HYPHEN_INDEX = 7;
const CANONICAL_LENGTH = 9;

/** A successfully parsed UPP. Numbers are decoded values, not characters. */
export interface ParsedUpp {
  readonly ok: true;
  /** The argument exactly as supplied — untrimmed, original case (PRD §5). */
  readonly raw: string;
  /** The canonical spelling: uppercase, hyphenated. `C867A69-8`. */
  readonly canonical: string;
  readonly starport: StarportClass;
  readonly size: number;
  readonly atmosphere: number;
  readonly hydrographics: number;
  readonly population: number;
  readonly government: number;
  readonly lawLevel: number;
  readonly techLevel: number;
}

/**
 * Why a UPP was rejected.
 *
 * The code is for callers that want to branch; the message is for the user, and
 * R1 asks for it to be clear rather than generic. Every message below names
 * either the offending position or the structural fault, and no two distinct
 * faults share wording — there is a test asserting exactly that, because
 * "invalid UPP" is the failure mode this whole type exists to prevent.
 */
export type UppErrorCode =
  | 'empty'
  | 'interior-whitespace'
  | 'wrong-length'
  | 'missing-hyphen'
  | 'misplaced-hyphen'
  | 'extra-hyphen'
  | 'bad-starport'
  | 'excluded-letter'
  | 'not-a-code'
  | 'out-of-range';

export interface UppError {
  readonly ok: false;
  readonly code: UppErrorCode;
  /** Ready to show inline, beneath the field. */
  readonly message: string;
  /** 1-based UPP position at fault, or 0 when the fault is structural. */
  readonly position: number;
  /** 0-based index into the trimmed input, or -1 when no single character is at fault. */
  readonly index: number;
}

/** The result of a parse. Never a thrown exception, for any input whatsoever. */
export type UppParseResult = ParsedUpp | UppError;

/** Narrow a parse result to its failure case. */
export function isUppError(result: UppParseResult): result is UppError {
  return !result.ok;
}

/**
 * Fold one ASCII letter to uppercase.
 *
 * Deliberately not `String.prototype.toUpperCase`, which is not
 * length-preserving over Unicode — `'ß'.toUpperCase()` is `'SS'`, and `'ﬁ'` is
 * `'FI'`. Folding the whole string would therefore shift every index after such
 * a character, so an error would name the wrong position, and a nine-character
 * input could become ten. Folding ASCII only keeps index arithmetic honest and
 * leaves everything else to fail the character checks below, which is correct.
 */
function asciiUpper(c: string): string {
  return c >= 'a' && c <= 'z' ? String.fromCharCode(c.charCodeAt(0) - 32) : c;
}

/** The ehex character for a value, for `formatUpp`. */
function ehexChar(value: number): string {
  return EHEX[value] ?? '?';
}

function fail(code: UppErrorCode, message: string, position: number, index: number): UppError {
  return { ok: false, code, message, position, index };
}

/**
 * Parse a UPP string.
 *
 * @param text Any string. Malformed input returns a `UppError` naming the
 *   offending position; nothing throws, including for input that is not a
 *   string-shaped UPP at all.
 */
export function parseUpp(text: string): UppParseResult {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return fail('empty', 'Enter a UPP, for example C867A69-8.', 0, -1);
  }

  // Interior whitespace before length, so a pasted `C867 A69-8` is told what is
  // actually wrong rather than being counted as ten characters.
  const spaceAt = trimmed.search(/\s/);
  if (spaceAt !== -1) {
    return fail(
      'interior-whitespace',
      `Remove the space at character ${String(spaceAt + 1)}: a UPP has no spaces in it.`,
      0,
      spaceAt,
    );
  }

  const firstHyphen = trimmed.indexOf('-');
  const lastHyphen = trimmed.lastIndexOf('-');
  if (firstHyphen !== lastHyphen) {
    return fail(
      'extra-hyphen',
      `A UPP has one hyphen, before the Tech Level code. Remove the one at ` +
        `character ${String(lastHyphen + 1)}.`,
      0,
      lastHyphen,
    );
  }

  // Count the codes independently of the hyphen so that a missing hyphen and a
  // missing code are reported as the different mistakes they are.
  const codeCount = firstHyphen === -1 ? trimmed.length : trimmed.length - 1;
  if (codeCount !== UPP_POSITIONS.length) {
    return fail('wrong-length', lengthMessage(trimmed, codeCount), 0, -1);
  }

  if (firstHyphen === -1) {
    return fail(
      'missing-hyphen',
      `A hyphen separates the Tech Level code: did you mean ` +
        `${trimmed.slice(0, HYPHEN_INDEX)}-${trimmed.slice(HYPHEN_INDEX)}?`,
      0,
      -1,
    );
  }
  if (firstHyphen !== HYPHEN_INDEX) {
    const codes = trimmed.slice(0, firstHyphen) + trimmed.slice(firstHyphen + 1);
    return fail(
      'misplaced-hyphen',
      `The hyphen goes before the Tech Level code, at character ` +
        `${String(HYPHEN_INDEX + 1)}, not character ${String(firstHyphen + 1)}: did you mean ` +
        `${codes.slice(0, HYPHEN_INDEX)}-${codes.slice(HYPHEN_INDEX)}?`,
      0,
      firstHyphen,
    );
  }

  // Structurally `?######-?` from here. Validate left to right, so the message
  // points at the earliest mistake rather than an arbitrary one.
  const starportChar = asciiUpper(trimmed[0] ?? '');
  if (!STARPORT_CLASSES.includes(starportChar as StarportClass)) {
    return fail(
      'bad-starport',
      `Position 1 (Starport): '${trimmed[0] ?? ''}' is not a starport class. ` +
        `Expected ${STARPORT_CLASSES.join(', ')}.`,
      1,
      0,
    );
  }

  const values: number[] = [];
  for (const pos of UPP_POSITIONS) {
    if (pos.key === 'starport') continue;

    const rawChar = trimmed[pos.index] ?? '';
    const char = asciiUpper(rawChar);

    // I and O get their own message. Someone typing them is almost always
    // reaching for 1 and 0, and "not a valid code" would leave them re-reading
    // a character that looks correct.
    if (char === 'I' || char === 'O') {
      const meant = char === 'I' ? '1' : '0';
      return fail(
        'excluded-letter',
        `Position ${String(pos.position)} (${pos.name}): Traveller codes leave out ` +
          `I and O so they cannot be confused with 1 and 0. Did you mean '${meant}'?`,
        pos.position,
        pos.index,
      );
    }

    // The length guard is not redundant: `EHEX.indexOf('')` is 0, so a missing
    // character would otherwise decode as a perfectly valid zero.
    const value = char.length === 1 ? EHEX.indexOf(char) : -1;
    const max = pos.max ?? 0;
    if (value === -1) {
      return fail(
        'not-a-code',
        `Position ${String(pos.position)} (${pos.name}): '${rawChar}' is not a code. ` +
          `Expected 0–${ehexChar(max)}.`,
        pos.position,
        pos.index,
      );
    }
    if (value > max) {
      return fail(
        'out-of-range',
        `Position ${String(pos.position)} (${pos.name}): '${char}' is ${String(value)}, ` +
          `above the maximum of ${ehexChar(max)} (${String(max)}).`,
        pos.position,
        pos.index,
      );
    }

    values.push(value);
  }

  const [size, atmosphere, hydrographics, population, government, lawLevel, techLevel] = values as [
    number, number, number, number, number, number, number,
  ];

  return {
    ok: true,
    raw: text,
    // Built from the validated input characters, not from the decoded values,
    // so that `formatUpp` — which does go via the values — is an independent
    // derivation and the round-trip test actually asserts something.
    canonical:
      Array.from(trimmed.slice(0, HYPHEN_INDEX), asciiUpper).join('') +
      '-' +
      asciiUpper(trimmed[CANONICAL_LENGTH - 1] ?? ''),
    starport: starportChar as StarportClass,
    size,
    atmosphere,
    hydrographics,
    population,
    government,
    lawLevel,
    techLevel,
  };
}

/**
 * Explain a wrong number of codes.
 *
 * The two hints cover the forms PRD R1 used to accept and this parser no longer
 * does, which are the mistakes most likely to be made by someone who has used
 * Traveller tools before.
 */
function lengthMessage(trimmed: string, codeCount: number): string {
  const expected = UPP_POSITIONS.length;
  const base =
    `A UPP has ${String(expected)} codes in the form C867A69-8; this has ` +
    `${String(codeCount)}.`;

  if (codeCount === expected - 1) {
    if (trimmed.endsWith('-')) {
      return `${base} The Tech Level code after the hyphen is missing.`;
    }
    if (!STARPORT_CLASSES.includes(asciiUpper(trimmed[0] ?? '') as StarportClass)) {
      return `${base} Did you omit the starport class at the front?`;
    }
  }
  return base;
}

/**
 * Render a parsed UPP back to its canonical spelling.
 *
 * Rebuilt from the decoded values rather than returning the stored `canonical`,
 * which is what makes `formatUpp(parseUpp(s)) === parseUpp(s).canonical` a real
 * check that decoding and encoding agree rather than a tautology.
 */
export function formatUpp(upp: ParsedUpp): string {
  return (
    upp.starport +
    ehexChar(upp.size) +
    ehexChar(upp.atmosphere) +
    ehexChar(upp.hydrographics) +
    ehexChar(upp.population) +
    ehexChar(upp.government) +
    ehexChar(upp.lawLevel) +
    '-' +
    ehexChar(upp.techLevel)
  );
}
