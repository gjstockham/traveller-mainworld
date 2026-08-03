import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { BatteryReport } from '../web/verify.js';

/**
 * One cell of the cross-platform matrix: run the full battery in this engine,
 * on this OS, and compare every hash against the committed manifest.
 *
 * A failure here is Spike A answering its question. It is not a flake and not
 * something to loosen: per spike plan §A.3, any divergence anywhere selects the
 * WASM kernel on correctness grounds regardless of performance. So the
 * assertions below are exact equality against committed bytes, and the
 * diagnostics exist to name *where* — first divergent case, its index, both
 * hashes — because that is what the ADR has to record.
 */
const MANIFEST = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../manifest.json'), 'utf8'),
) as {
  genVersion: string;
  digest: string;
  cases: Record<string, { hash: string; samples: number }>;
};

function divergenceReport(report: BatteryReport): string {
  const first = report.mismatches[0];
  const lead =
    first === undefined
      ? 'no mismatch was reported'
      : `first divergence: case ${first.index} '${first.name}' (${first.reason}) — ` +
        `manifest ${first.expected ?? '—'}, this browser ${first.actual ?? '—'}`;
  return `${lead}\n\n${report.evidence}\n\nA divergence is a finding, not a flake: per spike plan §A.3 it selects the WASM kernel on correctness grounds.`;
}

test('the full battery is bit-identical to the committed manifest', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/verify.html');

  // Every outcome sets a terminal status, so this waits for the run rather than
  // for a pass — a failure should be reported by the assertions below, with the
  // divergent case named, not by a timeout that says nothing.
  await expect(page.locator('#status')).toHaveAttribute('data-status', /pass|fail|error/);

  const report = (await page.evaluate(() => window.__batteryReport)) as BatteryReport | undefined;
  expect(report, 'the page finished without publishing a report').toBeDefined();
  const result = report!;

  // On disk and in the log, on pass as well as failure: a green cell is the
  // evidence ADR-0001 rests on, and evidence nobody can read afterwards is
  // just a tick. The workflow uploads this directory from every cell.
  const evidencePath = testInfo.outputPath('evidence.txt');
  writeFileSync(evidencePath, `${result.evidence}\n`);
  await testInfo.attach('evidence.txt', { path: evidencePath, contentType: 'text/plain' });
  console.log(`\n${result.evidence}\n`);

  // The manifest is only meaningful for the generator version that produced it.
  expect(result.genVersion).toBe(MANIFEST.genVersion);

  // Guards against the cheap way to make a slow cell fast. The quick battery's
  // hashes could never match the manifest, but failing on *why* beats failing
  // on twenty-one mismatches.
  expect(result.size, 'the matrix must run the full battery').toBe('full');
  expect(result.cases.length).toBe(Object.keys(MANIFEST.cases).length);
  for (const c of result.cases) {
    expect(c.samples, `case '${c.name}' ran a different number of samples`).toBe(
      MANIFEST.cases[c.name]?.samples,
    );
  }

  expect(result.mismatches, divergenceReport(result)).toEqual([]);
  expect(result.digest, divergenceReport(result)).toBe(MANIFEST.digest);
  expect(result.status, divergenceReport(result)).toBe('pass');

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
