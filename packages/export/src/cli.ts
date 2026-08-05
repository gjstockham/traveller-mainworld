/**
 * `node dist/cli.js` — render a map to a file.
 *
 * The only module in this package that may import `node:` anything. Everything
 * it calls is platform-neutral, because the same modules render a map inside a
 * browser worker (R26); what is Node-specific here is reading the arguments and
 * writing the file.
 *
 * It exists for three reasons, in increasing order of importance:
 *
 * 1. Rendering a map without a browser is convenient.
 * 2. It is how the WP13 acceptance artefact — a 4096×2048 equirectangular export
 *    — is produced and re-produced. An acceptance criterion whose artefact can
 *    only be made by clicking is an acceptance criterion nobody re-checks.
 * 3. It puts a **µs-per-sample figure on the point path** on real work, which
 *    nobody has ever measured. See `--timing`, and see the warning it prints:
 *    this is Node under whatever OS you are on, not `pnpm bench` on the target
 *    laptop, and it must not be written into an evidence file as though it were.
 */
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import {
  FIXTURES,
  GEN_VERSION,
  fidelityFor,
  fidelitySummary,
  hashSeedString,
  interpret,
  isUppError,
  parseUpp,
  requireRuleset,
} from '@traveller-mainworld/core';

import { detailDepthFor } from './detailDepth.js';
import { buildExportJob, drawOverlays } from './exportMap.js';
import type { ExportJob } from './job.js';
import { titleMetadata } from './overlay/titleBlock.js';
import { encodePng } from './png.js';
import { projectionIds, requireProjection } from './projection/index.js';
import { renderMapSync } from './render.js';
import { REFERENCE_SIZES, parseSize } from './size.js';

const USAGE = `
Render a projected map from generation data.

  node dist/cli.js [options]

  --upp <string>        UPP to interpret. Default F20076C-F (Luna).
  --seed <text>         Seed. Default 42.
  --ruleset <id>        Interpretation layer. Default cepheus-1.
  --fixture <id>        A golden fixture world instead of a UPP.
  --size <WxH>          Output size. Default 2048x1024. R24 names
                        ${Object.keys(REFERENCE_SIZES).join(' and ')}.
  --projection <id>     ${projectionIds().join(' | ')}. Default equirectangular.
  --clip <deg>          Mercator clip latitude. Default 85.0511287798 (Web Mercator).
  --depth <n>           Override the detail depth. Default: derived from the size.
  --no-graticule        Omit the 15/30 degree graticule.
  --no-title            Omit the title block.
  --timing              Print elapsed time and microseconds per sample.
  --out <path>          Where to write the PNG. Default map.png.
`.trim();

interface Args {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument '${arg}'`);
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(name);
    } else {
      values.set(name, next);
      i++;
    }
  }
  return { flags, values };
}

/** Assemble the job. Exported so `cli.test.ts` can check the argument handling. */
export function jobFromArgs(args: Args): ExportJob {
  const { flags, values } = args;
  const size = parseSize(values.get('size') ?? '2048x1024');
  const projectionId = values.get('projection') ?? 'equirectangular';
  const clip = values.get('clip');
  const projectionOptions = clip === undefined ? {} : { clipDeg: Number(clip) };
  const depthText = values.get('depth');

  const shared = {
    size,
    projectionId,
    projectionOptions,
    graticule: !flags.has('no-graticule'),
    titleBlock: !flags.has('no-title'),
    ...(depthText === undefined ? {} : { depth: Number(depthText) }),
  };

  const fixtureId = values.get('fixture');
  if (fixtureId !== undefined) {
    if (values.has('upp') || values.has('seed') || values.has('ruleset')) {
      // The same refusal `chooseWorld` makes, for the same reason: a fixture is
      // a pinned spec and a UPP is a request to interpret one, so asking for
      // both is asking for two different worlds.
      throw new Error('--fixture cannot be combined with --upp, --seed or --ruleset');
    }
    const fixture = FIXTURES.find((f) => f.id === fixtureId);
    if (fixture === undefined) {
      throw new Error(
        `unknown fixture '${fixtureId}'. Available: ${FIXTURES.map((f) => f.id).join(', ')}`,
      );
    }
    return buildExportJob(
      fixture.world,
      {
        upp: undefined,
        fixtureId: fixture.id,
        seedText: undefined,
        rulesetId: undefined,
        rulesetName: undefined,
        fidelity: undefined,
      },
      shared,
    );
  }

  const uppText = values.get('upp') ?? 'F20076C-F';
  const seedText = values.get('seed') ?? '42';
  const parsed = parseUpp(uppText);
  if (isUppError(parsed)) {
    throw new Error(parsed.message);
  }
  if (parsed.size === 0) {
    throw new Error(
      `${parsed.canonical} is Size 0 — an asteroid or planetoid belt, not a single body. ` +
        'Belts are out of scope for this tool (PRD §3). Try Size 1 or above.',
    );
  }

  const ruleset = requireRuleset(values.get('ruleset') ?? 'cepheus-1');
  const spec = interpret(parsed, ruleset);
  const seed = hashSeedString(seedText);

  return buildExportJob(
    { seedHi: seed[0]!, seedLo: seed[1]!, spec },
    {
      upp: parsed.canonical,
      fixtureId: undefined,
      seedText,
      rulesetId: ruleset.id,
      rulesetName: ruleset.name,
      // The same function the viewer's badge is built from, which is why it
      // moved into `core` in this work package — see `ruleset/fidelity.ts`.
      fidelity: fidelitySummary(fidelityFor(parsed, ruleset)) || undefined,
    },
    shared,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const args = parseArgs(argv);
  const job = jobFromArgs(args);
  const projection = requireProjection(job.projectionId, job.projectionOptions);
  const out = args.values.get('out') ?? 'map.png';
  const samples = job.size.width * job.size.height;

  process.stdout.write(
    `${projection.name}, ${String(job.size.width)}x${String(job.size.height)}, ` +
      `detail depth ${String(job.depth)}${job.depthChosen ? '' : ' (overridden)'}, ` +
      `generator ${GEN_VERSION}\n` +
      `${String(samples)} samples; derived depth for this size is ` +
      `${String(detailDepthFor(projection, job.size))}\n`,
  );

  const started = performance.now();
  const raster = renderMapSync(job);
  const elapsed = performance.now() - started;
  drawOverlays(raster, job);

  const png = await encodePng(raster, titleMetadata(job, projection));
  await writeFile(out, png);

  process.stdout.write(`wrote ${out}, ${String(png.length)} bytes\n`);
  if (args.flags.has('timing')) {
    process.stdout.write(
      `render ${(elapsed / 1000).toFixed(1)} s, ` +
        `${((elapsed * 1000) / samples).toFixed(2)} us/sample\n` +
        'NOT EVIDENCE: this is Node on whatever machine you are on, not `pnpm bench` on the\n' +
        'minimum-target laptop, and it must not be quoted in an evidence file as though it were.\n',
    );
  }
}

await main();
