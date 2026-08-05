/**
 * Golden-hash runner.
 *
 *   node dist/cli.js verify             both artefacts against their manifests (CI default)
 *   node dist/cli.js verify --only=battery
 *   node dist/cli.js verify --only=fixtures
 *   node dist/cli.js update             regenerate manifest.json  (the battery)
 *   node dist/cli.js update:fixtures    regenerate fixtures.json  (the worlds)
 *
 * Two artefacts, two identities, one command that checks both — see the header
 * of `fixtureManifest.ts` for why they are separate and what stops them
 * drifting apart.
 *
 * Both `update` modes refuse unless the identity they are keyed on actually
 * moved, and unless CHANGELOG.md records it. Regenerating hashes is exactly how
 * a determinism regression gets covered up, so it takes a deliberate act that
 * leaves a diff behind — the change protocol in
 * docs/plans/phase0-implementation-plan.md §7.4, restated in the README.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEN_VERSION } from '@traveller-mainworld/core';

import { runBattery } from './battery.js';
import { type ChangelogRequirement, checkChangelog } from './changelog.js';
import {
  type FixtureManifest,
  buildFixtureManifest,
  compareFixtureManifest,
  fixtureManifestPreflight,
  formatFixtureMismatches,
} from './fixtureManifest.js';
import { FIXTURE_N, FIXTURE_TILES, fixtureSpecHash, fixturesDigest, runFixtures } from './fixtures.js';
import { type KernelApi, tsKernelApi } from './kernelApi.js';
import { type Manifest, buildManifest, compareToManifest, formatMismatches } from './manifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '../manifest.json');
const FIXTURES_PATH = join(HERE, '../fixtures.json');
const CHANGELOG_PATH = join(HERE, '../../../CHANGELOG.md');

const out = (text: string): void => void process.stdout.write(text);
const err = (text: string): void => void process.stderr.write(text);

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function readChangelog(): string | undefined {
  try {
    return readFileSync(CHANGELOG_PATH, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The kernel every manifest records.
 *
 * The TypeScript kernel, always: it is what the cross-platform matrix compares
 * against and what the viewer ships under ADR-0001. The WASM twin is compared
 * against it separately, by `golden:parity`.
 */
function kernel(): KernelApi {
  return tsKernelApi();
}

// --- battery ------------------------------------------------------------

function runBatteryLeg(): { results: ReturnType<typeof runBattery> } {
  out(`Determinism battery (generator ${GEN_VERSION}, typescript kernel)\n`);
  const started = Date.now();
  const results = runBattery(kernel(), undefined, (r) => {
    out(`  ${r.name.padEnd(28)} ${r.hash.slice(0, 16)}…  (${String(r.samples)} values)\n`);
  });
  out(`  finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);
  return { results };
}

function verifyBattery(): number {
  const { results } = runBatteryLeg();
  const existing = readJson<Manifest>(MANIFEST_PATH);

  if (!existing) {
    err(`No manifest at ${MANIFEST_PATH}. Generate one with: pnpm golden:update\n`);
    return 1;
  }
  if (existing.genVersion !== GEN_VERSION) {
    err(
      `Manifest is for generator ${existing.genVersion}, code is ${GEN_VERSION}.\n` +
        'Regenerate the manifest in the same PR as the version bump.\n',
    );
    return 1;
  }

  const mismatches = compareToManifest(existing, results);
  out(`${formatMismatches(mismatches)}\n`);
  return mismatches.length === 0 ? 0 : 1;
}

function updateBattery(): number {
  const existing = readJson<Manifest>(MANIFEST_PATH);
  if (existing && existing.genVersion === GEN_VERSION) {
    err(
      `Refusing to overwrite ${MANIFEST_PATH}: generator version is still ${GEN_VERSION}.\n` +
        'An intentional output change needs a version bump in the same PR.\n',
    );
    return 1;
  }

  const complaint = checkChangelog(readChangelog(), [
    {
      label: 'generator version',
      kind: 'heading',
      value: GEN_VERSION,
      suggestion: `## ${GEN_VERSION} — what changed in the kernel, and why the hashes moved`,
    },
  ]);
  if (complaint !== undefined) {
    err(`${complaint}\n`);
    return 1;
  }

  const { results } = runBatteryLeg();
  const manifest = buildManifest(GEN_VERSION, results);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  out(`Wrote manifest.json for ${GEN_VERSION} (digest ${manifest.digest})\n`);
  return 0;
}

// --- fixtures -----------------------------------------------------------

function runFixtureLeg(): { results: ReturnType<typeof runFixtures>; digest: string } {
  const specHash = fixtureSpecHash();
  out(
    `Golden fixtures (generator ${GEN_VERSION}, fixture set ${specHash.slice(0, 16)}…, ` +
      `${String(FIXTURE_TILES.length)} tiles at ${String(FIXTURE_N + 1)}²)\n`,
  );
  const started = Date.now();
  const results = runFixtures(kernel().generator(GEN_VERSION), {
    onProgress: (r) => {
      out(
        `  ${r.id.padEnd(18)} elev ${r.elevation.slice(0, 12)}…  ` +
          `mat ${r.materials.slice(0, 12)}…  alb ${r.albedo.slice(0, 12)}…` +
          ` (${String(r.albedoDistinct)} values)  water ${r.waterMask.slice(0, 12)}…` +
          `${r.waterMaskAllZero ? ' (all zero)' : ''}\n`,
      );
    },
  });
  out(`  finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);
  return { results, digest: fixturesDigest(results) };
}

function verifyFixtures(): number {
  const existing = readJson<FixtureManifest>(FIXTURES_PATH);
  if (!existing) {
    err(`No fixture manifest at ${FIXTURES_PATH}. Generate one with: pnpm golden:update:fixtures\n`);
    return 1;
  }

  const blocked = fixtureManifestPreflight(existing, GEN_VERSION, fixtureSpecHash(), FIXTURE_N);
  if (blocked !== undefined) {
    err(`${blocked}\n`);
    return 1;
  }

  const { results, digest } = runFixtureLeg();
  const mismatches = compareFixtureManifest(existing, results);
  out(`${formatFixtureMismatches(mismatches)}\n`);
  if (mismatches.length === 0 && digest !== existing.digest) {
    // Belt and braces: every hash matched but the digest did not, which means
    // the digest is computed over something the comparison does not read.
    err(`Fixture digest ${digest} does not match manifest ${existing.digest}.\n`);
    return 1;
  }
  return mismatches.length === 0 ? 0 : 1;
}

function updateFixtures(): number {
  const existing = readJson<FixtureManifest>(FIXTURES_PATH);
  const specHash = fixtureSpecHash();

  const requirements: ChangelogRequirement[] = [];
  if (existing) {
    const versionMoved = existing.genVersion !== GEN_VERSION;
    const specsMoved = existing.fixtureSpecHash !== specHash || existing.fixtureN !== FIXTURE_N;
    if (!versionMoved && !specsMoved) {
      err(
        `Refusing to overwrite ${FIXTURES_PATH}: generator version is still ${GEN_VERSION} and\n` +
          `the fixture set is still ${specHash.slice(0, 16)}…. Fixture hashes may only move when\n` +
          'the kernel version bumps or the fixture specs change; if they moved for any other\n' +
          'reason, that is the regression this manifest exists to catch.\n',
      );
      return 1;
    }
    if (versionMoved) {
      requirements.push({
        label: 'generator version',
        kind: 'heading',
        value: GEN_VERSION,
        suggestion: `## ${GEN_VERSION} — what changed in the kernel, and why the hashes moved`,
      });
    }
    if (specsMoved) {
      requirements.push({
        label: 'fixture set',
        kind: 'mention',
        value: specHash.slice(0, 16),
        suggestion: `fixture set \`${specHash.slice(0, 16)}…\` — which fixture changed, and why`,
      });
    }
  } else {
    requirements.push({
      label: 'fixture set',
      kind: 'mention',
      value: specHash.slice(0, 16),
      suggestion: `fixture set \`${specHash.slice(0, 16)}…\` — the fixture worlds this pins`,
    });
  }

  const complaint = checkChangelog(readChangelog(), requirements);
  if (complaint !== undefined) {
    err(`${complaint}\n`);
    return 1;
  }

  const { results, digest } = runFixtureLeg();
  const manifest = buildFixtureManifest(GEN_VERSION, specHash, FIXTURE_N, results, digest);
  writeFileSync(FIXTURES_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  out(`Wrote fixtures.json for ${GEN_VERSION} / ${specHash.slice(0, 16)}… (digest ${digest})\n`);
  return 0;
}

// --- entry point --------------------------------------------------------

function run(): number {
  const mode = process.argv[2] ?? 'verify';
  const only = process.argv.slice(3).find((a) => a.startsWith('--only='))?.slice('--only='.length);

  switch (mode) {
    case 'verify': {
      if (only !== undefined && only !== 'battery' && only !== 'fixtures') {
        err(`Unknown --only=${only}. Use 'battery' or 'fixtures'.\n`);
        return 2;
      }
      // Both legs run even when the first fails: which of the two artefacts
      // diverged is the finding, and stopping at the first would hide whether
      // the other agreed.
      const battery = only === 'fixtures' ? 0 : verifyBattery();
      const fixtures = only === 'battery' ? 0 : verifyFixtures();
      return battery === 0 && fixtures === 0 ? 0 : 1;
    }
    case 'update':
      return updateBattery();
    case 'update:fixtures':
      return updateFixtures();
    default:
      err(`Unknown mode '${mode}'. Use 'verify', 'update' or 'update:fixtures'.\n`);
      return 2;
  }
}

process.exit(run());
