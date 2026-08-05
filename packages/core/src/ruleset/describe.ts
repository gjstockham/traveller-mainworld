/**
 * Plain-English interpretation of a UPP (Phase 1 plan §4.4, feeding PRD R21).
 *
 * The info panel is where a GM actually reads the world, so this covers all
 * eight positions rather than the three the MVP generates from. The text
 * itself lives in the ruleset's prose tables; this file only walks
 * `UPP_POSITIONS` and looks each one up.
 *
 * **Keyed off `UPP_POSITIONS`, deliberately.** WP8 exported that table so the
 * panel and the interpreter iterate one list rather than each hardcoding the
 * same eight names — two copies of "Hydrographics" drift, and the copy that
 * drifts is the one the user reads next to a parser error message spelled the
 * other way.
 */
import type { ParsedUpp, UppPosition } from '../input/upp.js';
import { UPP_POSITIONS, portKind } from '../input/upp.js';
import { CEPHEUS_1 } from './cepheus1/index.js';
import type { ProseEntry, ProseTables, Ruleset } from './ruleset.js';

/** One position, described. */
export interface DescribedPosition {
  /** 1-based UPP position, matching {@link UppPosition.position}. */
  readonly position: number;
  /** Display name — "Size", "Law Level". */
  readonly name: string;
  /** The character as it appears in the canonical spelling. */
  readonly code: string;
  /**
   * The decoded numeric value, or `undefined` for the starport, which is
   * categorical rather than numeric.
   */
  readonly value: number | undefined;
  /** The rules' own short name for this code. */
  readonly label: string;
  /** A sentence or two for the panel. */
  readonly text: string;
}

/**
 * Name to show for position 1, given the class.
 *
 * `UPP_POSITIONS` calls it "Starport" because that is the position's name in
 * the encoding and in every error message, and that must not vary. What the
 * *panel* should say does vary: `F` through `Y` are spaceport classes, and a
 * panel headed "Starport: Good spaceport" is telling a reader two different
 * things about the same character.
 */
function positionName(pos: UppPosition, upp: ParsedUpp): string {
  if (pos.key !== 'starport') return pos.name;
  return portKind(upp.starport) === 'spaceport' ? 'Spaceport' : 'Starport';
}

/** A whole UPP, described. */
export interface UppDescription {
  /** The ruleset that supplied the prose, for the panel's attribution line. */
  readonly rulesetId: string;
  readonly rulesetName: string;
  /** The canonical spelling being described. */
  readonly canonical: string;
  /** One entry per position, in UPP order. */
  readonly positions: readonly DescribedPosition[];
}

/** Which prose table a position reads from. Starport is handled separately. */
function proseFor(tables: ProseTables, pos: UppPosition, upp: ParsedUpp): ProseEntry | undefined {
  if (pos.key === 'starport') return tables.starport[upp.starport];
  return tables[pos.key][upp[pos.key]];
}

/**
 * Describe every position of a parsed UPP.
 *
 * Total over any valid `ParsedUpp`: a code with no prose entry gets a
 * placeholder rather than a thrown error, because a missing sentence is not a
 * reason to blank the whole panel. `describe.test.ts` asserts no such
 * placeholder is reachable for `cepheus-1`, which is where a gap gets caught.
 */
export function describeUpp(upp: ParsedUpp, ruleset: Ruleset = CEPHEUS_1): UppDescription {
  const positions = UPP_POSITIONS.map((pos): DescribedPosition => {
    const entry = proseFor(ruleset.tables.prose, pos, upp);
    return {
      position: pos.position,
      name: positionName(pos, upp),
      code: upp.canonical[pos.index] ?? '?',
      value: pos.key === 'starport' ? undefined : upp[pos.key],
      label: entry?.label ?? 'Undescribed',
      text: entry?.text ?? `No description available for ${pos.name} in ruleset ${ruleset.id}.`,
    };
  });

  return {
    rulesetId: ruleset.id,
    rulesetName: ruleset.name,
    canonical: upp.canonical,
    positions,
  };
}

/**
 * Every code a ruleset's prose is expected to cover, as `table.code` strings.
 *
 * Exported so the coverage test can enumerate the obligation instead of
 * restating it: prose is outside the ruleset hash (a typo fix must not oblige
 * anyone to mint `cepheus-2`), so a *test* is the only thing standing between
 * a numeric table gaining a code and the panel silently having nothing to say
 * about it.
 */
export function missingProse(ruleset: Ruleset): string[] {
  const { prose, size, atmosphere, hydrographics } = ruleset.tables;
  const missing: string[] = [];

  const check = (table: readonly ProseEntry[], name: string, count: number): void => {
    for (let code = 0; code < count; code++) {
      const entry = table[code];
      if (entry === undefined || entry.label === '' || entry.text === '') {
        missing.push(`${name}.${String(code)}`);
      }
    }
  };

  check(prose.size, 'size', size.length);
  check(prose.atmosphere, 'atmosphere', atmosphere.length);
  check(prose.hydrographics, 'hydrographics', hydrographics.length);

  // The four positions with no numeric table of their own: their ceilings are
  // an encoding fact and live on UPP_POSITIONS, so that is what bounds them.
  for (const pos of UPP_POSITIONS) {
    if (pos.key === 'starport' || pos.max === undefined) continue;
    if (pos.key === 'size' || pos.key === 'atmosphere' || pos.key === 'hydrographics') continue;
    check(prose[pos.key], pos.key, pos.max + 1);
  }

  return missing;
}
