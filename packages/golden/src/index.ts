/**
 * Golden-hash harness (PRD R16). Fixtures, manifest and runners land in WP7;
 * this module exists from WP0 so the workspace wiring and CI job are real from
 * the first commit rather than bolted on later.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

/** Generator version the committed manifest was produced under. */
export function manifestVersion(): string {
  return GEN_VERSION;
}
