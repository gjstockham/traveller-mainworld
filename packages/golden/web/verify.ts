/**
 * The in-page determinism check (WP4, manual half).
 *
 * Playwright's WebKit is not Safari, so the automated matrix cannot answer the
 * question for real Safari, iOS or Android. Those are hand-checked, and a check
 * that has to be repeated on borrowed devices has to cost nothing: open a URL,
 * read PASS or FAIL, copy the evidence block into ADR-0001.
 *
 * The same page is what the Playwright cells drive, so the manual and automated
 * halves of the matrix are running identical code against the identical
 * manifest — a divergence between them would be a property of the browser,
 * which is the entire point, and never of the harness.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

import manifestJson from '../manifest.json';
import type { BatteryResult } from '../src/battery.js';
import { type Manifest, compareToManifest, formatMismatches } from '../src/manifest.js';

import type { BatterySizeName, StartRequest, WorkerMessage } from './protocol.js';

const manifest = manifestJson as Manifest;

/** What a run reports, in one object: the page prints it, Playwright reads it. */
export interface BatteryReport {
  readonly status: 'pass' | 'fail' | 'error';
  readonly genVersion: string;
  readonly manifestVersion: string;
  readonly size: BatterySizeName;
  readonly digest: string;
  readonly expectedDigest: string;
  readonly cases: readonly BatteryResult[];
  /** Mismatches, each carrying its position in the battery. Empty on a pass. */
  readonly mismatches: readonly {
    readonly index: number;
    readonly name: string;
    readonly expected: string | undefined;
    readonly actual: string | undefined;
    readonly reason: string;
  }[];
  readonly elapsedMs: number;
  readonly evidence: string;
}

declare global {
  interface Window {
    /** Set once the run finishes, in every outcome. The matrix spec reads this. */
    __batteryReport?: BatteryReport;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`verify.html is missing #${id}`);
  }
  return found as T;
}

const statusEl = el('status');
const summaryEl = el('summary');
const casesEl = el<HTMLTableSectionElement>('cases');
const detailEl = el('detail');
const evidenceEl = el('evidence');
const copyButton = el<HTMLButtonElement>('copy');

const sizeName: BatterySizeName =
  new URLSearchParams(location.search).get('quick') === null ? 'full' : 'quick';

function setStatus(status: 'running' | 'pass' | 'fail' | 'error', text: string): void {
  statusEl.dataset['status'] = status;
  statusEl.textContent = text;
}

function row(label: string, value: string): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  summaryEl.append(dt, dd);
}

/**
 * Everything needed to make a result citable months later.
 *
 * Device and browser versions are the evidence — "it passed on my phone" is not
 * something ADR-0001 can rest on. `navigator.userAgent` is the only identifier
 * available on every target, so the block is deliberately copy-paste shaped
 * rather than parsed.
 */
function evidenceBlock(report: Omit<BatteryReport, 'evidence'>): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lines: [string, string][] = [
    ['result', report.status.toUpperCase()],
    ['generator', report.genVersion],
    ['manifest', `${report.manifestVersion} (digest ${report.expectedDigest})`],
    ['battery', `${report.size} — ${String(report.cases.length)} cases`],
    ['digest', report.digest],
    ['duration', `${(report.elapsedMs / 1000).toFixed(1)} s`],
    ['user agent', navigator.userAgent],
    [
      'hardware',
      `cores ${String(navigator.hardwareConcurrency)}, memory ${
        nav.deviceMemory === undefined ? 'not reported' : `${String(nav.deviceMemory)} GB`
      }`,
    ],
    ['screen', `${String(screen.width)}×${String(screen.height)} @ ${String(devicePixelRatio)}`],
    ['run at', new Date().toISOString()],
  ];
  if (report.mismatches.length > 0) {
    const first = report.mismatches[0]!;
    lines.push([
      'first divergence',
      `case ${String(first.index)} '${first.name}' (${first.reason}): expected ${
        first.expected ?? '—'
      }, got ${first.actual ?? '—'}`,
    ]);
  }
  const width = Math.max(...lines.map(([label]) => label.length));
  return lines.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');
}

function appendCase(index: number, total: number, result: BatteryResult): void {
  const expected = manifest.cases[result.name];
  const ok = expected !== undefined && expected.hash === result.hash;
  const tr = document.createElement('tr');
  tr.dataset['ok'] = String(ok);
  // Verdict before hash: on a phone the row scrolls, and the column that must
  // survive that is the one saying whether this browser agreed.
  for (const text of [
    String(index + 1),
    result.name,
    ok ? 'match' : expected === undefined ? 'not in manifest' : 'DIFFERS',
    `${result.hash.slice(0, 16)}…`,
  ]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  casesEl.append(tr);
  setStatus('running', `Running… ${String(index + 1)} of ${String(total)} cases`);
}

function finish(results: readonly BatteryResult[], digest: string, elapsedMs: number): void {
  const mismatches = compareToManifest(manifest, results).map((m) => ({
    ...m,
    index: results.findIndex((r) => r.name === m.name),
  }));
  const versionMismatch = manifest.genVersion !== GEN_VERSION;
  const status = mismatches.length === 0 && !versionMismatch ? 'pass' : 'fail';

  const partial = {
    status,
    genVersion: GEN_VERSION,
    manifestVersion: manifest.genVersion,
    size: sizeName,
    digest,
    expectedDigest: manifest.digest,
    cases: results,
    mismatches,
    elapsedMs,
  } as const;
  const report: BatteryReport = { ...partial, evidence: evidenceBlock(partial) };

  row('generator', GEN_VERSION);
  row('battery', `${sizeName} — ${String(results.length)} cases`);
  row('digest', digest);
  row('expected', manifest.digest);
  row('duration', `${(elapsedMs / 1000).toFixed(1)} s`);

  if (status === 'pass') {
    setStatus('pass', 'PASS — every battery hash matches the committed manifest');
  } else if (versionMismatch) {
    setStatus(
      'fail',
      `FAIL — manifest is for generator ${manifest.genVersion}, this build is ${GEN_VERSION}`,
    );
  } else {
    const first = mismatches[0]!;
    setStatus(
      'fail',
      `FAIL — ${String(mismatches.length)} mismatch(es), first at case ${String(first.index)} ` +
        `'${first.name}'`,
    );
    detailEl.textContent = formatMismatches(mismatches);
    detailEl.hidden = false;
  }

  evidenceEl.textContent = report.evidence;
  copyButton.hidden = false;
  window.__batteryReport = report;
}

function fail(message: string): void {
  setStatus('error', `ERROR — ${message}`);
  const partial = {
    status: 'error',
    genVersion: GEN_VERSION,
    manifestVersion: manifest.genVersion,
    size: sizeName,
    digest: '',
    expectedDigest: manifest.digest,
    cases: [],
    mismatches: [],
    elapsedMs: 0,
  } as const;
  const evidence = `${evidenceBlock(partial)}\nerror     ${message}`;
  evidenceEl.textContent = evidence;
  copyButton.hidden = false;
  window.__batteryReport = { ...partial, evidence };
}

copyButton.addEventListener('click', () => {
  void navigator.clipboard?.writeText(evidenceEl.textContent ?? '');
});

if (sizeName === 'quick') {
  const warning = document.createElement('p');
  warning.className = 'warning';
  warning.textContent =
    'Quick battery: for developing this page only. Its hashes are not comparable ' +
    'to the manifest, so this run cannot pass — drop ?quick to check a browser.';
  statusEl.after(warning);
}

let worker: Worker;
try {
  worker = new Worker(new URL('./battery.worker.ts', import.meta.url), { type: 'module' });
} catch (error) {
  // Not a silent fallback to the main thread: a browser without module workers
  // is itself a result, and one worth recording next to the passes.
  fail(
    `this browser could not start a module worker (${
      error instanceof Error ? error.message : String(error)
    }). Record the browser and version; the battery was not run.`,
  );
  throw error;
}

worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'case':
      appendCase(message.index, message.total, message.result);
      break;
    case 'done':
      finish(message.results, message.digest, message.elapsedMs);
      break;
    case 'failure':
      fail(message.message);
      break;
  }
});
worker.addEventListener('error', (event) => {
  fail(event.message || 'the battery worker failed to load');
});

setStatus('running', 'Running the battery…');
worker.postMessage({ type: 'start', size: sizeName } satisfies StartRequest);
