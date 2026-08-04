/**
 * Regenerate `packages/core/test/data/ruleset-expectations.json`.
 *
 * That file is the committed record of what each ruleset interprets a set of
 * known UPPs into: a digest over the ruleset's numeric tables, plus a per-UPP
 * spec hash and the readable spec behind it.
 *
 * ## The one thing this script refuses to do
 *
 * **It will not re-bless an existing ruleset id whose table digest has moved.**
 *
 * That is the enforcement for the identity rule in
 * `packages/core/src/ruleset/ruleset.ts`: a share URL carries
 * `?ruleset=cepheus-1` (PRD R27), so editing a `cepheus-1` table under the same
 * id silently changes every world anyone has ever shared, with no version
 * anywhere moving to say so. The supported way to change a table is to mint a
 * new id — `cepheus-2` — and leave the old data module frozen and present.
 *
 * Without this refusal the file would be a snapshot that gets re-blessed
 * whenever it goes red, which is a check that reports whatever it is told.
 *
 * ## Usage
 *
 *   pnpm ruleset:update            # writes the file
 *   pnpm ruleset:update --check    # exit 1 if it is out of date, write nothing
 *
 * Reads the built package, so `pnpm --filter @traveller-mainworld/core build`
 * has to have run; the `ruleset:update` script does that for you.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = join(root, 'packages/core/test/data/ruleset-expectations.json');

const {
  RULESETS,
  interpretText,
  rulesetHash,
  specHash,
} = await import(join(root, 'packages/core/dist/index.js'));

/**
 * The known UPPs (Phase 1 plan §4 acceptance).
 *
 * Chosen to span the interpreter's whole input space rather than Phase 1's
 * scope fence: **every Size code 0–A appears exactly once**, the Atmosphere
 * codes include each structurally distinct case — vacuum, trace, the three
 * hazard classes (A, B, C), the two altitude-limited ones (D, E) and the
 * unusual one (F) — Hydrographics walks 0 to A, and position 1 walks the
 * starport classes.
 *
 * Eleven, not the plan's ten: there are eleven Size codes, and one-per-code is
 * a property a test can state and check, where ten-of-eleven is an arbitrary
 * omission that would have to be justified every time someone read the list.
 *
 * `X000000-0` is first for a reason: Size 0 is a belt with zero gravity in the
 * table, so it is the row that would put `Infinity` on a spec if the crater
 * transition's clamp were ever removed.
 */
const UPPS = [
  'X000000-0',
  'X100000-0',
  'X210000-1',
  'E340000-3',
  'E4A0000-5',
  'D5D3333-6',
  'C6E5544-7',
  'B7B7654-9',
  'C867A69-8',
  'A9C8876-B',
  'AAFACFF-F',
];

function build() {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const ruleset of RULESETS) {
    out[ruleset.id] = {
      name: ruleset.name,
      rulesetHash: rulesetHash(ruleset),
      upps: UPPS.map((upp) => {
        const spec = interpretText(upp, ruleset);
        return { upp, specHash: specHash(spec), spec };
      }),
    };
  }
  return out;
}

function readCommitted() {
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return undefined;
  }
}

const fresh = build();
const committed = readCommitted();
const check = process.argv.includes('--check');

if (committed !== undefined) {
  const moved = Object.keys(fresh).filter(
    (id) => committed[id] !== undefined && committed[id].rulesetHash !== fresh[id].rulesetHash,
  );
  if (moved.length > 0) {
    for (const id of moved) {
      console.error(
        `\nRuleset '${id}' has been edited in place.\n` +
          `  committed tables: ${committed[id].rulesetHash}\n` +
          `  this build:       ${fresh[id].rulesetHash}\n`,
      );
    }
    console.error(
      "A ruleset id is a promise to a share URL somebody else is holding (PRD R27):\n" +
        "'?ruleset=cepheus-1' must mean the same world forever. So a table change mints a\n" +
        'NEW id rather than moving an existing one.\n\n' +
        'To make this change:\n' +
        '  1. Add a new data module beside the old one — e.g. cepheus2/ — and leave the\n' +
        '     old tables exactly as they are. Keeping them costs one frozen module.\n' +
        '  2. Register it in packages/core/src/ruleset/index.ts (RULESETS grows; it never\n' +
        '     shrinks), and point DEFAULT_RULESET at it if it is to be the new default.\n' +
        '  3. Add a CHANGELOG.md entry naming the new id and what moved.\n' +
        '  4. Re-run this script. It will add the new id and leave the old one untouched.\n\n' +
        'See packages/core/src/ruleset/ruleset.ts for the argument in full.',
    );
    process.exit(1);
  }
}

const text = `${JSON.stringify(fresh, null, 2)}\n`;
const current = committed === undefined ? undefined : `${JSON.stringify(committed, null, 2)}\n`;

if (check) {
  if (text !== current) {
    console.error(
      `${target} is out of date. Run: pnpm ruleset:update\n` +
        '(No ruleset table moved, so this is a new ruleset, a new UPP in the list, or a\n' +
        'change to how specs are assembled or serialised.)',
    );
    process.exit(1);
  }
  console.log(`Ruleset expectations current: ${Object.keys(fresh).join(', ')}.`);
} else {
  writeFileSync(target, text);
  console.log(
    `Wrote ${target}\n  ${Object.keys(fresh)
      .map((id) => `${id} ${fresh[id].rulesetHash.slice(0, 16)}… over ${String(UPPS.length)} UPPs`)
      .join('\n  ')}`,
  );
}
