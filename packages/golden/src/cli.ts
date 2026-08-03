/**
 * Battery runner.
 *
 *   node dist/cli.js verify   compare against the committed manifest (CI default)
 *   node dist/cli.js update   regenerate the manifest
 *
 * `update` refuses to run unless the generator version differs from the one in
 * the manifest. Regenerating hashes is exactly how determinism regressions get
 * covered up, so it takes a deliberate version bump — the change protocol in
 * docs/plans/phase0-implementation-plan.md §7.4.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEN_VERSION } from '@traveller-mainworld/core';

import { runBattery } from './battery.js';
import { type Manifest, buildManifest, compareToManifest, formatMismatches } from './manifest.js';

const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), '../manifest.json');

function readManifest(): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

function run(): number {
  const mode = process.argv[2] ?? 'verify';
  const started = Date.now();

  process.stdout.write(`Running determinism battery (generator ${GEN_VERSION})\n`);
  const results = runBattery((r) => {
    process.stdout.write(`  ${r.name.padEnd(28)} ${r.hash.slice(0, 16)}…  (${r.samples} values)\n`);
  });
  process.stdout.write(`Battery finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);

  const existing = readManifest();

  if (mode === 'update') {
    if (existing && existing.genVersion === GEN_VERSION) {
      process.stderr.write(
        `Refusing to overwrite the manifest: generator version is still ${GEN_VERSION}.\n` +
          'An intentional output change needs a version bump in the same PR.\n',
      );
      return 1;
    }
    const manifest = buildManifest(GEN_VERSION, results);
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Wrote manifest for ${GEN_VERSION} (digest ${manifest.digest})\n`);
    return 0;
  }

  if (mode !== 'verify') {
    process.stderr.write(`Unknown mode '${mode}'. Use 'verify' or 'update'.\n`);
    return 2;
  }

  if (!existing) {
    process.stderr.write(
      `No manifest at ${MANIFEST_PATH}. Generate one with: pnpm golden:update\n`,
    );
    return 1;
  }

  if (existing.genVersion !== GEN_VERSION) {
    process.stderr.write(
      `Manifest is for generator ${existing.genVersion}, code is ${GEN_VERSION}.\n` +
        'Regenerate the manifest in the same PR as the version bump.\n',
    );
    return 1;
  }

  const mismatches = compareToManifest(existing, results);
  process.stdout.write(`${formatMismatches(mismatches)}\n`);
  return mismatches.length === 0 ? 0 : 1;
}

process.exit(run());
