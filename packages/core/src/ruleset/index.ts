/**
 * The ruleset interpretation layer (PRD §6.2, R5–R7).
 *
 * `(UPP, ruleset) → PhysicalWorldSpec`, holding **all** rules knowledge, with
 * the generator downstream knowing nothing about UPPs. See `ruleset.ts` for
 * the plugin interface and the identity rules, `interpret.ts` for the
 * assembler, and `cepheus1/` for the default tables.
 *
 * ## The registry
 *
 * A share URL carries `?ruleset=cepheus-1` (PRD R27), so an id arriving from
 * outside has to be resolved, and an id that does not exist has to fail
 * loudly. {@link requireRuleset} does; {@link rulesetFor} returns `undefined`
 * for callers that want to branch. Falling back to the default on an unknown
 * id would render a world that is not the world the URL names, which is the
 * one failure mode share URLs exist to prevent — and it is the same lesson
 * WP14's `generatorFor(version)` seam is being built on.
 */
export {
  PHYSICAL_UPP_KEYS,
  rowFor,
  rulesetHash,
  serialiseRuleset,
} from './ruleset.js';
export type {
  AtmosphereRow,
  HydrographicsRow,
  ProseEntry,
  ProseTables,
  Ruleset,
  RulesetTables,
  SizeRow,
} from './ruleset.js';

export { CEPHEUS_1, CEPHEUS_1_ID } from './cepheus1/index.js';
export { interpret, interpretText } from './interpret.js';
export { describeUpp, missingProse } from './describe.js';
export type { DescribedPosition, UppDescription } from './describe.js';
export { leafPaths, serialiseSpec, specHash } from './serialise.js';
export { deepFreeze, deepFrozenViolations } from './freeze.js';

import { CEPHEUS_1 } from './cepheus1/index.js';
import type { Ruleset } from './ruleset.js';

/**
 * Every ruleset this build can interpret.
 *
 * Grows, and never shrinks: a frozen ruleset stays here forever so that every
 * share URL ever emitted keeps resolving. That is the whole cost of the
 * "mint a new id, never edit in place" rule — one data module per retune.
 */
export const RULESETS: readonly Ruleset[] = Object.freeze([CEPHEUS_1]);

/** The ruleset used when none is named. */
export const DEFAULT_RULESET: Ruleset = CEPHEUS_1;

/** Resolve a ruleset id, or `undefined` if this build does not have it. */
export function rulesetFor(id: string): Ruleset | undefined {
  return RULESETS.find((r) => r.id === id);
}

/**
 * Resolve a ruleset id, throwing if this build does not have it.
 *
 * Never falls back to {@link DEFAULT_RULESET}. A URL naming `cepheus-2` opened
 * in a build that only has `cepheus-1` describes a world this build cannot
 * produce, and quietly producing a different one would break the promise the
 * id exists to make.
 */
export function requireRuleset(id: string): Ruleset {
  const found = rulesetFor(id);
  if (found === undefined) {
    throw new Error(
      `unknown ruleset '${id}'. This build has: ${RULESETS.map((r) => r.id).join(', ')}.`,
    );
  }
  return found;
}
