import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { FixtureManifest } from '../src/fixtureManifest.js';
import type { Manifest } from '../src/manifest.js';
import type { VerifyReport } from '../web/verify.js';

/**
 * One cell of the cross-platform matrix: run both golden artefacts in this
 * engine, on this OS, and compare every hash against the committed manifests.
 *
 * A failure here is Spike A answering its question. It is not a flake and not
 * something to loosen: per spike plan §A.3, any divergence anywhere selects the
 * WASM kernel on correctness grounds regardless of performance. So the
 * assertions below are exact equality against committed bytes, and the
 * diagnostics exist to name *where* — first divergent case or fixture, both
 * hashes — because that is what the ADR has to record.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(HERE, '../manifest.json'), 'utf8')) as Manifest;
const FIXTURES = JSON.parse(readFileSync(join(HERE, '../fixtures.json'), 'utf8')) as FixtureManifest;

function divergenceReport(report: VerifyReport): string {
  const battery = report.mismatches[0];
  const fixture = report.fixtureMismatches[0];
  const lines: string[] = [];
  if (battery !== undefined) {
    lines.push(
      `first battery divergence: case ${String(battery.index)} '${battery.name}' ` +
        `(${battery.reason}) — manifest ${battery.expected ?? '—'}, ` +
        `this browser ${battery.actual ?? '—'}`,
    );
  }
  if (fixture !== undefined) {
    lines.push(
      `first fixture divergence: ${fixture.fixture} / ${fixture.buffer} (${fixture.reason}) — ` +
        `manifest ${fixture.expected ?? '—'}, this browser ${fixture.actual ?? '—'}`,
    );
  }
  if (report.fixtureBlocker !== undefined) {
    lines.push(`fixtures not comparable: ${report.fixtureBlocker}`);
  }
  if (lines.length === 0) {
    lines.push('no mismatch was reported');
  }
  return `${lines.join('\n')}\n\n${report.evidence}\n\nA divergence is a finding, not a flake: per spike plan §A.3 it selects the WASM kernel on correctness grounds.`;
}

test('the battery and the fixtures are bit-identical to the committed manifests', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // Asserted, not assumed: `reuseExistingServer` is on outside CI, so a stale
  // preview server can serve a page that never publishes a report, and waiting
  // for a status that cannot appear says nothing about float determinism.
  const response = await page.goto('/verify.html');
  expect(response?.ok(), `/verify.html did not load (status ${String(response?.status())})`).toBe(
    true,
  );

  // Every outcome sets a terminal status, so this waits for the run rather than
  // for a pass — a failure should be reported by the assertions below, with the
  // divergent case named, not by a timeout that says nothing.
  await expect(page.locator('#status')).toHaveAttribute('data-status', /pass|fail|error/);

  const report = (await page.evaluate(() => window.__goldenReport)) as VerifyReport | undefined;
  expect(report, 'the page finished without publishing a report').toBeDefined();
  const result = report!;

  // On disk and in the log, on pass as well as failure: a green cell is the
  // evidence ADR-0001 rests on, and evidence nobody can read afterwards is
  // just a tick. The workflow uploads this directory from every cell.
  // Short, explicit timeouts on the two UI assertions below. The config's
  // 600 s `expect` timeout is sized for waiting out a full battery run; letting
  // a button assertion inherit it turns a one-line UI regression into a
  // ten-minute failure in each of nine cells, which is how a cheap check
  // becomes an expensive one nobody wants to keep.
  const UI_TIMEOUT = 10_000;
  const copyButton = page.locator('#copy');
  await expect(copyButton, 'the evidence copy button never appeared').toBeVisible({
    timeout: UI_TIMEOUT,
  });

  const evidencePath = testInfo.outputPath('evidence.txt');
  writeFileSync(evidencePath, `${result.evidence}\n`);
  await testInfo.attach('evidence.txt', { path: evidencePath, contentType: 'text/plain' });
  console.log(`\n${result.evidence}\n`);

  // The manifests are only meaningful for the generator version that produced
  // them, and the fixture hashes only for the fixture set that produced them.
  expect(result.genVersion).toBe(MANIFEST.genVersion);
  expect(result.genVersion).toBe(FIXTURES.genVersion);
  expect(result.fixtureSpecHash, 'the cell ran a different fixture set').toBe(
    FIXTURES.fixtureSpecHash,
  );
  expect(result.fixtureBlocker, 'the fixture comparison did not run').toBeUndefined();

  // Guards against the cheap way to make a slow cell fast. The quick sizes'
  // hashes could never match, but failing on *why* beats failing on thirty
  // mismatches. A slow cell is a runner to fix — the page already shards the
  // fixture run across workers — never a set to trim.
  expect(result.size, 'the matrix must run the full battery and fixture set').toBe('full');
  expect(result.cases.length).toBe(Object.keys(MANIFEST.cases).length);
  for (const c of result.cases) {
    expect(c.samples, `case '${c.name}' ran a different number of samples`).toBe(
      MANIFEST.cases[c.name]?.samples,
    );
  }
  expect(result.fixtures.length).toBe(Object.keys(FIXTURES.fixtures).length);
  for (const f of result.fixtures) {
    expect(f.tiles, `fixture '${f.id}' generated a different tile set`).toBe(FIXTURES.tileCount);
    expect(f.vertices, `fixture '${f.id}' generated a different vertex count`).toBe(
      FIXTURES.fixtures[f.id]?.vertices,
    );
  }

  expect(result.mismatches, divergenceReport(result)).toEqual([]);
  expect(result.digest, divergenceReport(result)).toBe(MANIFEST.digest);
  expect(result.fixtureMismatches, divergenceReport(result)).toEqual([]);
  expect(result.fixtureDigest, divergenceReport(result)).toBe(FIXTURES.digest);
  expect(result.status, divergenceReport(result)).toBe('pass');

  // The evidence block has to be gettable off the device, and the button that
  // does it used to fail silently where `navigator.clipboard` is unavailable —
  // which is every plain-HTTP LAN address, i.e. exactly the phones M2 and M3
  // are checked on. Whatever this engine allows, the label must change: copied,
  // or selected-and-said-so. It must never look like nothing happened.
  const before = await copyButton.textContent();
  await copyButton.click();
  await expect(copyButton, 'the Copy evidence button did nothing visible').not.toHaveText(
    before ?? '',
    { timeout: UI_TIMEOUT },
  );

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
