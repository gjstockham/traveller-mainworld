import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { BUILD_PROFILES, INVARIANCE_PROFILES } from '../build-profiles.mjs';
import type { FixtureManifest } from '../src/fixtureManifest.js';
import type { Manifest } from '../src/manifest.js';
import type { VerifyReport } from '../web/verify.js';

/**
 * The build-invariance cell (implementation plan §7.3).
 *
 * PRD R11 promises deterministic generation; nothing in that promise mentions a
 * bundler, and a minifier is free to rewrite an expression in ways that change
 * float results without changing what the source says. The nine matrix cells
 * all drive one bundle, so they would agree with each other perfectly while
 * every one of them ran subtly rewritten arithmetic.
 *
 * So this runs the same page built two further ways — unminified, and under
 * Vite's defaults as `packages/viewer` builds it — and holds each to the same
 * committed manifests. Same bytes on disk, three pipelines.
 *
 * Deliberately not a `browser-matrix` cell: a bundler is not an engine. This
 * asks whether the build changed the arithmetic, on one engine, which is the
 * question §7.3 poses. Which engines agree is the other cell's question.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(HERE, '../manifest.json'), 'utf8')) as Manifest;
const FIXTURES = JSON.parse(readFileSync(join(HERE, '../fixtures.json'), 'utf8')) as FixtureManifest;

for (const name of INVARIANCE_PROFILES) {
  const profile = BUILD_PROFILES[name]!;

  test(`the '${name}' bundle produces the committed hashes`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    // Assert the page exists before waiting on it. `reuseExistingServer` is on
    // outside CI, so a preview server left running from before these profiles
    // existed will happily serve a 404 here — and waiting for a status
    // attribute that can never appear turns a stale build into a fifteen-minute
    // timeout that says nothing about determinism.
    const response = await page.goto(profile.url);
    expect(
      response?.ok(),
      `${profile.url} did not load (status ${String(response?.status())}). The '${name}' build ` +
        'profile is missing from dist-web — run `pnpm --filter @traveller-mainworld/golden ' +
        'build:web`, and check no stale `vite preview` is holding port 4174.',
    ).toBe(true);
    await expect(page.locator('#status')).toHaveAttribute('data-status', /pass|fail|error/);

    const report = (await page.evaluate(() => window.__goldenReport)) as VerifyReport | undefined;
    expect(report, 'the page finished without publishing a report').toBeDefined();
    const result = report!;

    const evidencePath = testInfo.outputPath(`evidence-${name}.txt`);
    const evidence = `build profile  ${name} (target ${profile.target ?? 'vite default'}, minify ${
      profile.minify === false ? 'off' : 'vite default'
    })\n${result.evidence}\n`;
    writeFileSync(evidencePath, evidence);
    await testInfo.attach(`evidence-${name}.txt`, {
      path: evidencePath,
      contentType: 'text/plain',
    });
    console.log(`\n${evidence}`);

    // The same assertions the matrix makes. A bundler that altered arithmetic
    // would show here as a hash difference against bytes on disk, which is the
    // only comparison that cannot itself be rewritten by the bundler.
    expect(result.size, 'the invariance cell must run the full battery and fixture set').toBe(
      'full',
    );
    expect(result.fixtureBlocker, 'the fixture comparison did not run').toBeUndefined();
    expect(result.fixtureSpecHash).toBe(FIXTURES.fixtureSpecHash);
    expect(result.mismatches, failureReport(name, result)).toEqual([]);
    expect(result.digest, failureReport(name, result)).toBe(MANIFEST.digest);
    expect(result.fixtureMismatches, failureReport(name, result)).toEqual([]);
    expect(result.fixtureDigest, failureReport(name, result)).toBe(FIXTURES.digest);
    expect(result.status, failureReport(name, result)).toBe('pass');

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
}

function failureReport(profile: string, report: VerifyReport): string {
  return (
    `The '${profile}' bundle produced different hashes from the committed manifests, while the\n` +
    'source it was built from did not change. That points at the bundler, not the kernel:\n' +
    'a minifier re-associating or contracting float arithmetic is the risk this cell exists\n' +
    'for (implementation plan §9). Compare against the `matrix` profile before touching\n' +
    `either manifest.\n\n${report.evidence}`
  );
}
