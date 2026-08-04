/**
 * `cepheus-1` — the default ruleset (PRD R6).
 *
 * **This id is frozen.** Every value reachable from here is part of what
 * `?ruleset=cepheus-1` promises to a share URL somebody else is holding
 * (PRD R27), so the tables are deep-frozen at load and a change to any of them
 * mints `cepheus-2` rather than editing this. `ruleset.ts` carries that
 * argument in full, and `scripts/update-ruleset-expectations.mjs` refuses to
 * re-bless an id whose digest has moved.
 *
 * **Open Game Content.** The three numeric tables and the prose are derived
 * from the Cepheus Engine System Reference Document under the Open Game
 * License 1.0a — see `LICENSE-OGL.txt`. This file, and the assembler in
 * `../interpret.ts`, are not: they are project code under the repository's MIT
 * licence. `README.md` §Licensing states the split file by file.
 */
import { deepFreeze } from '../freeze.js';
import type { Ruleset } from '../ruleset.js';
import { ATMOSPHERE_ROWS } from './atmosphere.js';
import { HYDROGRAPHICS_ROWS } from './hydrographics.js';
import { CEPHEUS_1_PROSE } from './prose.js';
import { SIZE_ROWS } from './size.js';

/** The id, as it appears in share URLs and export metadata. */
export const CEPHEUS_1_ID = 'cepheus-1';

export const CEPHEUS_1: Ruleset = deepFreeze({
  id: CEPHEUS_1_ID,
  name: 'Cepheus Engine',
  tables: {
    size: SIZE_ROWS,
    atmosphere: ATMOSPHERE_ROWS,
    hydrographics: HYDROGRAPHICS_ROWS,
    prose: CEPHEUS_1_PROSE,

    /**
     * Earth's own simple/complex crater transition, ~3.2 km.
     *
     * Scaled inversely with surface gravity by the assembler, which lands Mars
     * (0.35g here) at ~9 km against a real ~7 km, and a Size 2 Luna-analogue
     * (0.15g) at ~21 km against Luna's real ~19 km. Close enough for a game
     * aid, from one constant and one division.
     */
    craterTransitionAt1gKm: 3.2,

    /**
     * The floor that keeps a belt from putting `Infinity` on a spec.
     *
     * Size 0's gravity is genuinely zero in the table above, and the crater
     * transition divides by gravity. 0.01g makes that division finite without
     * being reachable by any real row — the smallest non-zero gravity in the
     * Size table is 0.05g — so this clamp affects Size 0 and nothing else.
     */
    minSurfaceGravityG: 0.01,
  },
});
