/**
 * The in-page determinism check (WP4 manual half, WP7 fixtures).
 *
 * Playwright's WebKit is not Safari, so the automated matrix cannot answer the
 * question for real Safari, iOS or Android. Those are hand-checked, and a check
 * that has to be repeated on borrowed devices has to cost nothing: open a URL,
 * read PASS or FAIL, copy the evidence block into the WP4 evidence table.
 *
 * The same page is what the Playwright cells drive, so the manual and automated
 * halves of the matrix run identical code against identical manifests — a
 * divergence between them would be a property of the browser, which is the
 * entire point, and never of the harness.
 *
 * Two artefacts are checked here, both of them, always: the determinism battery
 * against `manifest.json` and the golden fixtures against `fixtures.json`.
 * There is deliberately no way to run one and report a pass.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

import fixtureManifestJson from '../fixtures.json';
import manifestJson from '../manifest.json';
import type { BatteryResult } from '../src/battery.js';
import {
  type FixtureManifest,
  type FixtureMismatch,
  compareFixtureManifest,
  fixtureManifestPreflight,
  formatFixtureMismatches,
} from '../src/fixtureManifest.js';
import {
  type FixtureResult,
  FULL_FIXTURES,
  QUICK_FIXTURES,
  fixtureSpecHash,
  fixturesDigest,
  resolveFixtureRun,
} from '../src/fixtures.js';
import { type Manifest, compareToManifest, formatMismatches } from '../src/manifest.js';

import type { RunSizeName, StartRequest, WorkerMessage } from './protocol.js';

const manifest = manifestJson as Manifest;

/**
 * The commit this bundle was built from, injected by the Pages workflow.
 *
 * An evidence block that cannot be tied back to a commit is weak evidence: the
 * generator version and both digests say *what* was run, and this says *which
 * build of it*. `local build` when served from a working tree, which is itself
 * information — a hand-check pasted from a local build is not reproducible by
 * anyone else.
 */
const BUILD_COMMIT: string = import.meta.env['VITE_COMMIT'] ?? 'local build';
const fixtureManifest = fixtureManifestJson as FixtureManifest;

/**
 * Workers the fixture run is spread across.
 *
 * Capped rather than taken straight from `hardwareConcurrency`: each worker
 * holds its own scratch buffers for a whole fixture — about 27 MB at the full
 * size — and a sixteen-core machine spawning sixteen of those would trade a
 * runtime win for an out-of-memory on the phones this page exists to check.
 */
const MAX_WORKERS = 4;

export interface VerifyReport {
  readonly status: 'pass' | 'fail' | 'error';
  readonly genVersion: string;
  readonly manifestVersion: string;
  readonly size: RunSizeName;
  readonly workers: number;
  /** Commit the bundle was built from, or `local build`. */
  readonly buildCommit: string;

  /** Determinism battery, against `manifest.json`. */
  readonly digest: string;
  readonly expectedDigest: string;
  readonly cases: readonly BatteryResult[];
  readonly mismatches: readonly {
    readonly index: number;
    readonly name: string;
    readonly expected: string | undefined;
    readonly actual: string | undefined;
    readonly reason: string;
  }[];

  /** Golden fixtures, against `fixtures.json`. */
  readonly fixtureDigest: string;
  readonly expectedFixtureDigest: string;
  readonly fixtureSpecHash: string;
  readonly manifestFixtureSpecHash: string;
  readonly fixtures: readonly FixtureResult[];
  readonly fixtureMismatches: readonly FixtureMismatch[];
  /** Set when the fixture comparison could not meaningfully run at all. */
  readonly fixtureBlocker: string | undefined;

  readonly elapsedMs: number;
  readonly evidence: string;
}

declare global {
  interface Window {
    /** Set once the run finishes, in every outcome. The matrix spec reads this. */
    __goldenReport?: VerifyReport;
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
const fixturesEl = el<HTMLTableSectionElement>('fixtures');
const detailEl = el('detail');
const evidenceEl = el('evidence');
const copyButton = el<HTMLButtonElement>('copy');

const sizeName: RunSizeName =
  new URLSearchParams(location.search).get('quick') === null ? 'full' : 'quick';
const runSize = sizeName === 'quick' ? QUICK_FIXTURES : FULL_FIXTURES;
const plan = resolveFixtureRun(runSize);

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

function appendRow(tbody: HTMLTableSectionElement, ok: boolean, cells: readonly string[]): void {
  const tr = document.createElement('tr');
  tr.dataset['ok'] = String(ok);
  for (const text of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  tbody.append(tr);
}

/**
 * Everything needed to make a result citable months later.
 *
 * Device and browser versions are the evidence — "it passed on my phone" is not
 * something an ADR can rest on. `navigator.userAgent` is the only identifier
 * available on every target, so the block is deliberately copy-paste shaped
 * rather than parsed.
 */
function evidenceBlock(report: Omit<VerifyReport, 'evidence'>): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lines: [string, string][] = [
    ['result', report.status.toUpperCase()],
    ['generator', report.genVersion],
    ['manifest', `${report.manifestVersion} (digest ${report.expectedDigest})`],
    ['battery', `${report.size} — ${String(report.cases.length)} cases`],
    ['battery digest', report.digest],
    ['fixture set', `${report.fixtureSpecHash} (manifest ${report.manifestFixtureSpecHash})`],
    ['fixtures', `${report.size} — ${String(report.fixtures.length)} worlds`],
    ['fixture digest', `${report.fixtureDigest} (expected ${report.expectedFixtureDigest})`],
    ['duration', `${(report.elapsedMs / 1000).toFixed(1)} s across ${String(report.workers)} worker(s)`],
    ['user agent', navigator.userAgent],
    [
      'hardware',
      `cores ${String(navigator.hardwareConcurrency)}, memory ${
        nav.deviceMemory === undefined ? 'not reported' : `${String(nav.deviceMemory)} GB`
      }`,
    ],
    ['screen', `${String(screen.width)}×${String(screen.height)} @ ${String(devicePixelRatio)}`],
    ['run at', new Date().toISOString()],
    ['build', report.buildCommit],
  ];
  if (report.fixtureBlocker !== undefined) {
    lines.push(['fixtures blocked', report.fixtureBlocker]);
  }
  const first = report.mismatches[0];
  if (first !== undefined) {
    lines.push([
      'first battery divergence',
      `case ${String(first.index)} '${first.name}' (${first.reason}): expected ${
        first.expected ?? '—'
      }, got ${first.actual ?? '—'}`,
    ]);
  }
  const firstFixture = report.fixtureMismatches[0];
  if (firstFixture !== undefined) {
    lines.push([
      'first fixture divergence',
      `${firstFixture.fixture} / ${firstFixture.buffer} (${firstFixture.reason}): expected ${
        firstFixture.expected ?? '—'
      }, got ${firstFixture.actual ?? '—'}`,
    ]);
  }
  const width = Math.max(...lines.map(([label]) => label.length));
  return lines.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');
}

// --- worker pool --------------------------------------------------------

const workerCount = Math.max(
  1,
  Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 1, plan.fixtures.length),
);

function spawn(): Worker {
  return new Worker(new URL('./battery.worker.ts', import.meta.url), { type: 'module' });
}

/** Send one request to one worker and resolve when it reports a terminal message. */
function dispatch(
  worker: Worker,
  request: StartRequest,
  onMessage: (message: WorkerMessage) => void,
): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const handle = (event: MessageEvent<WorkerMessage>): void => {
      const message = event.data;
      onMessage(message);
      if (message.type === 'case' || message.type === 'fixture') return;
      worker.removeEventListener('message', handle);
      if (message.type === 'failure') {
        reject(new Error(message.message));
      } else {
        resolve(message);
      }
    };
    worker.addEventListener('message', handle);
    worker.addEventListener('error', (event) => {
      reject(new Error(event.message || 'the worker failed to load'));
    });
    worker.postMessage(request);
  });
}

// --- run ----------------------------------------------------------------

let caseIndex = 0;

function onBatteryCase(result: BatteryResult): void {
  const expected = manifest.cases[result.name];
  const ok = expected !== undefined && expected.hash === result.hash;
  // Verdict before hash: on a phone the row scrolls, and the column that must
  // survive that is the one saying whether this browser agreed.
  appendRow(casesEl, ok, [
    String(caseIndex + 1),
    result.name,
    ok ? 'match' : expected === undefined ? 'not in manifest' : 'DIFFERS',
    `${result.hash.slice(0, 16)}…`,
  ]);
  caseIndex++;
  setStatus('running', `Battery… ${String(caseIndex)} cases`);
}

function onFixture(result: FixtureResult, done: number): void {
  const expected = fixtureManifest.fixtures[result.id];
  const ok =
    expected !== undefined &&
    expected.elevation === result.elevation &&
    expected.materials === result.materials &&
    expected.waterMask === result.waterMask;
  appendRow(fixturesEl, ok, [
    result.id,
    ok ? 'match' : expected === undefined ? 'not in manifest' : 'DIFFERS',
    `${result.elevation.slice(0, 12)}…`,
    `${result.materials.slice(0, 12)}…`,
    result.waterMaskAllZero ? 'all zero' : 'NON-ZERO',
  ]);
  setStatus('running', `Fixtures… ${String(done)} of ${String(plan.fixtures.length)} worlds`);
}

async function run(): Promise<void> {
  const started = performance.now();
  const workers = Array.from({ length: workerCount }, spawn);

  try {
    setStatus('running', 'Running the determinism battery…');
    const batteryDone = await dispatch(workers[0]!, { type: 'battery', size: sizeName }, (m) => {
      if (m.type === 'case') onBatteryCase(m.result);
    });
    if (batteryDone.type !== 'battery-done') {
      throw new Error(`battery worker reported '${batteryDone.type}'`);
    }

    setStatus('running', `Running ${String(plan.fixtures.length)} fixture worlds…`);
    // Round-robin, so a shard is a slice of the set rather than a contiguous
    // block — a systematic ordering bug shows on every worker rather than one.
    const shards: string[][] = Array.from({ length: workerCount }, () => []);
    plan.fixtures.forEach((f, i) => shards[i % workerCount]!.push(f.id));

    let done = 0;
    const shardResults = await Promise.all(
      workers.map((worker, i) =>
        dispatch(worker, { type: 'fixtures', size: sizeName, ids: shards[i]! }, (m) => {
          if (m.type === 'fixture') onFixture(m.result, ++done);
        }),
      ),
    );

    const collected = new Map<string, FixtureResult>();
    for (const message of shardResults) {
      if (message.type !== 'fixtures-done') {
        throw new Error(`fixture worker reported '${message.type}'`);
      }
      for (const result of message.results) collected.set(result.id, result);
    }
    // Canonical order, not completion order: the digest is a committed value
    // and must not depend on which shard finished first.
    const fixtureResults = plan.fixtures.map((f) => {
      const result = collected.get(f.id);
      if (result === undefined) {
        throw new Error(`fixture '${f.id}' was assigned to a shard but never reported`);
      }
      return result;
    });

    finish(
      batteryDone.results,
      batteryDone.digest,
      fixtureResults,
      performance.now() - started,
    );
  } finally {
    for (const worker of workers) worker.terminate();
  }
}

function finish(
  results: readonly BatteryResult[],
  digest: string,
  fixtures: readonly FixtureResult[],
  elapsedMs: number,
): void {
  const mismatches = compareToManifest(manifest, results).map((m) => ({
    ...m,
    index: results.findIndex((r) => r.name === m.name),
  }));

  const specHash = fixtureSpecHash();
  const fixtureBlocker = fixtureManifestPreflight(
    fixtureManifest,
    GEN_VERSION,
    specHash,
    runSize.n,
  );
  const fixtureMismatches =
    fixtureBlocker === undefined ? compareFixtureManifest(fixtureManifest, fixtures) : [];
  const fixtureDigest = fixturesDigest(fixtures);

  const versionMismatch = manifest.genVersion !== GEN_VERSION;
  const status =
    mismatches.length === 0 &&
    fixtureMismatches.length === 0 &&
    fixtureBlocker === undefined &&
    !versionMismatch &&
    fixtureDigest === fixtureManifest.digest
      ? 'pass'
      : 'fail';

  const partial = {
    status,
    genVersion: GEN_VERSION,
    manifestVersion: manifest.genVersion,
    size: sizeName,
    workers: workerCount,
    buildCommit: BUILD_COMMIT,
    digest,
    expectedDigest: manifest.digest,
    cases: results,
    mismatches,
    fixtureDigest,
    expectedFixtureDigest: fixtureManifest.digest,
    fixtureSpecHash: specHash,
    manifestFixtureSpecHash: fixtureManifest.fixtureSpecHash,
    fixtures,
    fixtureMismatches,
    fixtureBlocker,
    elapsedMs,
  } as const;
  const report: VerifyReport = { ...partial, evidence: evidenceBlock(partial) };

  row('generator', GEN_VERSION);
  row('battery', `${sizeName} — ${String(results.length)} cases`);
  row('battery digest', `${digest}  (expected ${manifest.digest})`);
  row('fixture set', `${specHash.slice(0, 16)}…  (manifest ${fixtureManifest.fixtureSpecHash.slice(0, 16)}…)`);
  row('fixture digest', `${fixtureDigest}  (expected ${fixtureManifest.digest})`);
  row('duration', `${(elapsedMs / 1000).toFixed(1)} s across ${String(workerCount)} worker(s)`);

  if (status === 'pass') {
    setStatus('pass', 'PASS — every battery and fixture hash matches the committed manifests');
  } else if (versionMismatch) {
    setStatus(
      'fail',
      `FAIL — manifest is for generator ${manifest.genVersion}, this build is ${GEN_VERSION}`,
    );
  } else {
    const parts: string[] = [];
    if (mismatches.length > 0) parts.push(`${String(mismatches.length)} battery`);
    if (fixtureBlocker !== undefined) parts.push('fixtures not comparable');
    else if (fixtureMismatches.length > 0) parts.push(`${String(fixtureMismatches.length)} fixture`);
    else if (fixtureDigest !== fixtureManifest.digest) parts.push('fixture digest');
    setStatus('fail', `FAIL — ${parts.join(', ')} mismatch(es)`);
    detailEl.textContent = [
      mismatches.length > 0 ? formatMismatches(mismatches) : '',
      fixtureBlocker ?? formatFixtureMismatches(fixtureMismatches),
    ]
      .filter(Boolean)
      .join('\n\n');
    detailEl.hidden = false;
  }

  evidenceEl.textContent = report.evidence;
  copyButton.hidden = false;
  window.__goldenReport = report;
}

function fail(message: string): void {
  setStatus('error', `ERROR — ${message}`);
  const partial = {
    status: 'error',
    genVersion: GEN_VERSION,
    manifestVersion: manifest.genVersion,
    size: sizeName,
    workers: workerCount,
    buildCommit: BUILD_COMMIT,
    digest: '',
    expectedDigest: manifest.digest,
    cases: [],
    mismatches: [],
    fixtureDigest: '',
    expectedFixtureDigest: fixtureManifest.digest,
    fixtureSpecHash: fixtureSpecHash(),
    manifestFixtureSpecHash: fixtureManifest.fixtureSpecHash,
    fixtures: [],
    fixtureMismatches: [],
    fixtureBlocker: undefined,
    elapsedMs: 0,
  } as const;
  const evidence = `${evidenceBlock(partial)}\nerror     ${message}`;
  evidenceEl.textContent = evidence;
  copyButton.hidden = false;
  window.__goldenReport = { ...partial, evidence };
}

/**
 * Copy, or fall back to selecting the text and saying so.
 *
 * `navigator.clipboard` is secure-context only. Served over plain HTTP from a
 * LAN address — the obvious way to reach a phone — it is `undefined`, and the
 * previous `navigator.clipboard?.writeText(...)` swallowed that: the button did
 * nothing, silently, while the instructions said "press Copy evidence and paste
 * the block". A hand-check that cannot hand back its evidence is not a
 * hand-check, and a control that fails without saying so is worse than one that
 * is not there.
 */
function selectEvidence(): void {
  const range = document.createRange();
  range.selectNodeContents(evidenceEl);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

copyButton.addEventListener('click', () => {
  const { clipboard } = navigator;
  if (clipboard === undefined) {
    selectEvidence();
    copyButton.textContent = 'Selected — copy by hand (the clipboard API needs HTTPS)';
    return;
  }
  void clipboard.writeText(evidenceEl.textContent ?? '').then(
    () => {
      copyButton.textContent = 'Copied';
    },
    () => {
      selectEvidence();
      copyButton.textContent = 'Selected — copy by hand (the clipboard was refused)';
    },
  );
});

if (sizeName === 'quick') {
  const warning = document.createElement('p');
  warning.className = 'warning';
  warning.textContent =
    'Quick run: for developing this page only. Its hashes are not comparable to the ' +
    'committed manifests, so this run cannot pass — drop ?quick to check a browser.';
  statusEl.after(warning);
}

setStatus('running', 'Starting…');
run().catch((error: unknown) => {
  // Not a silent fallback to the main thread: a browser that cannot run this is
  // itself a result, and one worth recording next to the passes.
  fail(error instanceof Error ? error.message : String(error));
});
