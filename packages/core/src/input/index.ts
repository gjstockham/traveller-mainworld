/**
 * The input layer (PRD §6.1): what a user types, turned into what the
 * interpreter consumes.
 *
 * Pure, headless and free of rules knowledge. `parseUpp` decodes characters
 * into numbers; the ruleset interpreter (WP9) turns those numbers into a
 * `PhysicalWorldSpec`.
 */
export {
  STARPORT_CLASSES,
  UPP_POSITIONS,
  formatUpp,
  isUppError,
  parseUpp,
} from './upp.js';
export type {
  ParsedUpp,
  StarportClass,
  UppCodeKey,
  UppError,
  UppErrorCode,
  UppParseResult,
  UppPosition,
} from './upp.js';

export { defaultRandomWords, randomSeedText, rerollSeed, resolveSeed } from './seed.js';
export type { RandomWords, ResolvedSeed, SeedSource } from './seed.js';
