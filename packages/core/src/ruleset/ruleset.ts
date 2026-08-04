/**
 * The ruleset plugin interface (PRD R6, R7) and the identity rules that make it
 * safe to have more than one.
 *
 * A ruleset is **pure data**: three numeric tables and one prose table. The
 * function that assembles them into a `PhysicalWorldSpec` is code and lives in
 * `interpret.ts`. PRD §10's open question — "should ruleset plugins be
 * data-only or code?" — leans data-first with an escape hatch, and this is that
 * lean made concrete: a ruleset that only disagrees about *numbers* is a new
 * data module and nothing else. A ruleset that disagrees about the *assembly*
 * has to change `interpret`, which is deliberately more expensive, because R7's
 * promise is that adding a ruleset does not change output for any existing
 * ruleset + UPP + seed combination and a shared assembler is what makes that
 * checkable rather than hoped for.
 *
 * ## Three identities, and why conflating any two breaks a promise
 *
 * | Identity | Covers | Moves when | Lives in |
 * |---|---|---|---|
 * | `GEN_VERSION` | `packages/core` generation arithmetic | the kernel's maths changes | `core/index.ts` |
 * | **Ruleset id** (`cepheus-1`) | the interpretation tables | *never* — see below | this module |
 * | Fixture-spec hash | the golden fixture set's inputs | fixtures change | `packages/golden/fixtures.json` |
 *
 * **The rule: a change to a ruleset table mints a new id. It never bumps
 * `GEN_VERSION`, and it never edits an existing ruleset in place.**
 *
 * The reason is R7 read literally. A share URL carries `?ruleset=cepheus-1`
 * (R27), so `cepheus-1` is a promise to a URL somebody else is holding. Editing
 * one digit of a table under that name silently changes every world anyone has
 * ever shared, and no version anywhere moves to say so. Minting `cepheus-2`
 * instead costs one frozen data module and keeps every old URL correct forever
 * — the same obligation R15 places on generator versions, and far cheaper to
 * honour here because a ruleset is data rather than a code path.
 *
 * `GEN_VERSION` does *not* gain a ruleset component (Phase 1 plan open question
 * 4). They have separate lifecycles — the kernel's arithmetic can change
 * without any table moving, and vice versa — and both travel in the share URL
 * as separate parameters, so there is nothing to gain by fusing them and a
 * phantom generator version to mint every time a table is retuned.
 *
 * ## How the rule is enforced
 *
 * {@link rulesetHash} digests a ruleset's tables. `packages/core/test/data/`
 * pins that digest per ruleset id alongside ten interpreted specs, and
 * `scripts/update-ruleset-expectations.mjs` **refuses to rewrite the file when
 * an existing id's digest has moved** — the update path for a table change is
 * to mint a new id, not to re-bless the old one. From WP14 the golden fixtures
 * hash `interpret(upp, ruleset)` too, so the same edit also fails CI on a spec
 * hash before it can reach a tile.
 */
import type { StarportClass, UppCodeKey } from '../input/upp.js';
import type { CompositionClass, PressureBand, TemperatureBand } from '../spec.js';
import { sha256Hex } from '../digest/sha256.js';

/**
 * One row of the Size table.
 *
 * `radiusKm` and `surfaceGravityG` are the rules' own numbers.
 * `terrainAmplitudeM`, `fbmFrequency` and `fbmOctaves` are not — no tabletop
 * ruleset has an opinion about peak-to-trough relief — but they are per-size
 * constants that decide what a world looks like, so they belong in the table
 * a ruleset owns rather than as magic numbers in the assembler.
 */
export interface SizeRow {
  /** The Size code this row describes, 0–10. */
  readonly code: number;
  readonly radiusKm: number;
  /** Earth gravities. Zero for a belt, which is not a body. */
  readonly surfaceGravityG: number;
  /** Peak-to-trough relief in metres. */
  readonly terrainAmplitudeM: number;
  /** First-octave frequency, in cycles per unit of input space. */
  readonly fbmFrequency: number;
  /** Octaves summed in the base terrain field. */
  readonly fbmOctaves: number;
}

/** One row of the Atmosphere table. */
export interface AtmosphereRow {
  /** The Atmosphere code this row describes, 0–15. */
  readonly code: number;
  readonly pressureBand: PressureBand;
  /** Representative surface pressure in bar. */
  readonly pressureBar: number;
  readonly composition: CompositionClass;
  /**
   * How well this atmosphere lets an impact record survive, in `[0, 1]`.
   *
   * 1.0 is a vacuum: nothing ablates the incoming body, nothing erodes the
   * crater afterwards. A standard atmosphere is an order of magnitude worse on
   * both counts. This is the column that makes a Cepheus code decide whether a
   * world reads as Luna or as Earth.
   */
  readonly craterPreservation: number;
  /**
   * The thermal regime this atmosphere implies on its own, before
   * hydrographics are considered. See {@link TemperatureBand}.
   */
  readonly baseTemperature: TemperatureBand;
}

/** One row of the Hydrographics table. */
export interface HydrographicsRow {
  /** The Hydrographics code this row describes, 0–10. */
  readonly code: number;
  /** Fraction of the surface covered by liquid, in `[0, 1]`. */
  readonly coverage: number;
}

/**
 * Plain-English text for one code (Phase 1 plan §4.4, feeding PRD R21).
 *
 * `label` is the rules' own short name — "Standard, tainted" — and `text` is a
 * sentence or two a GM can read at the table. Both are Open Game Content; see
 * `LICENSE-OGL.txt`.
 */
export interface ProseEntry {
  readonly label: string;
  readonly text: string;
}

/**
 * Prose for every position, keyed the way {@link ProseTables} is indexed.
 *
 * Starport is keyed by its class letter because it is categorical; every other
 * position is indexed by its numeric code.
 */
export interface ProseTables {
  readonly starport: Readonly<Record<StarportClass, ProseEntry>>;
  readonly size: readonly ProseEntry[];
  readonly atmosphere: readonly ProseEntry[];
  readonly hydrographics: readonly ProseEntry[];
  readonly population: readonly ProseEntry[];
  readonly government: readonly ProseEntry[];
  readonly lawLevel: readonly ProseEntry[];
  readonly techLevel: readonly ProseEntry[];
}

/** The data half of a ruleset. Frozen, hashed, and never edited in place. */
export interface RulesetTables {
  readonly size: readonly SizeRow[];
  readonly atmosphere: readonly AtmosphereRow[];
  readonly hydrographics: readonly HydrographicsRow[];
  readonly prose: ProseTables;
  /**
   * Crater transition diameter in km at one Earth gravity.
   *
   * Anchored on Earth's own ~3.2 km simple/complex transition; the assembler
   * scales it inversely with surface gravity, which reproduces Mars (~8 km)
   * and Luna (~19 km) closely enough for a game aid.
   */
  readonly craterTransitionAt1gKm: number;
  /**
   * Floor applied to surface gravity before dividing by it.
   *
   * A belt's gravity is negligible and the Size table says zero. Dividing by
   * that would put `Infinity` on a spec that WP14 hashes and WP10 reads, so
   * the assembler clamps. The floor is a *table* value rather than a constant
   * in the assembler because it changes what the numbers are, and everything
   * that changes what the numbers are belongs to the ruleset's identity.
   */
  readonly minSurfaceGravityG: number;
}

/**
 * A complete ruleset: an identity, a name, and the tables.
 *
 * There is no function on this interface. That is the point — see the module
 * header.
 */
export interface Ruleset {
  /**
   * Stable identity, carried in share URLs (PRD R27) and export metadata.
   *
   * Immutable for the life of the tables it names. A table change mints a new
   * id; it does not re-point this one.
   */
  readonly id: string;
  /** Human-readable name, for the info panel. */
  readonly name: string;
  readonly tables: RulesetTables;
}

/** Bytes of an ASCII string, mirroring the golden harness's serialisation rule. */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(
        `ruleset serialisation must be ASCII so its bytes are unambiguous; found U+${code
          .toString(16)
          .toUpperCase()} at ${String(i)}`,
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Canonical text form of a ruleset's *numeric* tables.
 *
 * Field order and formatting are fixed here rather than delegated to
 * `JSON.stringify`, because this string is a committed identity: it must not
 * move because a property was reordered in a literal or because a serialiser
 * changed how it renders a number. `String(number)` is safe — the ECMAScript
 * number-to-string algorithm is exact and specified, so every engine renders
 * these identically.
 *
 * **Prose is excluded deliberately.** Fixing a typo in a description does not
 * change a single generated pixel, and should not oblige anyone to mint
 * `cepheus-2`. What prose *does* get is a coverage test, so it cannot go
 * missing for a code the numeric tables still accept.
 */
export function serialiseRuleset(ruleset: Ruleset): string {
  const t = ruleset.tables;
  const lines: string[] = [
    `ruleset=${ruleset.id}`,
    `craterTransitionAt1gKm=${String(t.craterTransitionAt1gKm)}`,
    `minSurfaceGravityG=${String(t.minSurfaceGravityG)}`,
  ];

  for (const row of t.size) {
    lines.push(
      `size=${String(row.code)}`,
      `  radiusKm=${String(row.radiusKm)}`,
      `  surfaceGravityG=${String(row.surfaceGravityG)}`,
      `  terrainAmplitudeM=${String(row.terrainAmplitudeM)}`,
      `  fbmFrequency=${String(row.fbmFrequency)}`,
      `  fbmOctaves=${String(row.fbmOctaves)}`,
    );
  }
  for (const row of t.atmosphere) {
    lines.push(
      `atmosphere=${String(row.code)}`,
      `  pressureBand=${row.pressureBand}`,
      `  pressureBar=${String(row.pressureBar)}`,
      `  composition=${row.composition}`,
      `  craterPreservation=${String(row.craterPreservation)}`,
      `  baseTemperature=${row.baseTemperature}`,
    );
  }
  for (const row of t.hydrographics) {
    lines.push(`hydrographics=${String(row.code)}`, `  coverage=${String(row.coverage)}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Identity of a ruleset's numeric tables.
 *
 * Moves the instant any table value moves, which is exactly the event the
 * "mint a new id, never edit in place" rule exists to make impossible to do
 * quietly. See the module header for what enforces it.
 */
export function rulesetHash(ruleset: Ruleset): string {
  return sha256Hex(asciiBytes(serialiseRuleset(ruleset)));
}

/** The `ParsedUpp` keys the interpreter reads. Everything else is Phase 6's. */
export const PHYSICAL_UPP_KEYS: readonly UppCodeKey[] = Object.freeze([
  'size',
  'atmosphere',
  'hydrographics',
]);

/** Look a row up by code, failing loudly rather than returning `undefined`. */
export function rowFor<T extends { readonly code: number }>(
  rows: readonly T[],
  code: number,
  what: string,
  rulesetId: string,
): T {
  const row = rows[code];
  // Indexed rather than searched, and then checked, so a table whose rows are
  // out of order is a loud error here instead of a silently wrong world.
  if (row === undefined || row.code !== code) {
    const found = rows.find((r) => r.code === code);
    if (found !== undefined) {
      throw new Error(
        `ruleset ${rulesetId}: ${what} table is not indexed by code — ${what} ${String(code)} ` +
          `is at position ${String(rows.indexOf(found))}. Rows must be in code order.`,
      );
    }
    throw new Error(`ruleset ${rulesetId}: no ${what} row for code ${String(code)}`);
  }
  return row;
}
