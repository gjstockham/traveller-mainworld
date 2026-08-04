/**
 * Cepheus Engine — the Hydrographics table.
 *
 * **OPEN GAME CONTENT.** Derived from the Cepheus Engine System Reference
 * Document, used under the Open Game License 1.0a. See `LICENSE-OGL.txt`.
 *
 * The rule is one line — coverage is `code × 10%` — and this file could have
 * been that line. It is a table instead for two reasons. A ruleset that
 * disagrees (a house rule that reads code A as 95% rather than 100%, say)
 * should be a data change and not a code change; and `code / 10` is a division
 * whose results (0.1, 0.3, 0.7) are the *nearest doubles* to those decimals
 * rather than the decimals, so writing them out makes the serialised identity
 * show exactly what is stored. `code * 0.1` would have been worse still —
 * `3 * 0.1` is 0.30000000000000004.
 *
 * **Phase 1 stores this and does not use it.** R8's sea-level solve, which
 * makes coverage a hard constraint against the generated terrain, is Phase 2.
 * What Phase 1 does with the number is let it suppress craters, which is the
 * one thing standing liquid unambiguously does.
 */
import type { HydrographicsRow } from '../ruleset.js';

/** Rows in code order; `rowFor` asserts that ordering rather than assuming it. */
export const HYDROGRAPHICS_ROWS: readonly HydrographicsRow[] = [
  { code: 0, coverage: 0 },
  { code: 1, coverage: 0.1 },
  { code: 2, coverage: 0.2 },
  { code: 3, coverage: 0.3 },
  { code: 4, coverage: 0.4 },
  { code: 5, coverage: 0.5 },
  { code: 6, coverage: 0.6 },
  { code: 7, coverage: 0.7 },
  { code: 8, coverage: 0.8 },
  { code: 9, coverage: 0.9 },
  { code: 10, coverage: 1 },
];
