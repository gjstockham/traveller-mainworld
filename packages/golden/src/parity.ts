/**
 * TypeScript kernel vs Rust/WASM twin.
 *
 * **This is the WP3 deliverable.** The point of building the kernel twice is
 * not redundancy — it is that the two implementations must hash identically *to
 * each other*, not merely be self-consistent. A kernel compared only against
 * its own past output confirms it is stable; two kernels compared against each
 * other confirm they are *right*, because a bug would have to be reproduced
 * independently in two languages by two different sets of hands to survive.
 *
 * Three layers of comparison, coarse to fine, so a failure says something
 * useful rather than "17 cases differ":
 *
 * 1. **Constants.** `TAN_AT_ONE` and the octave rotation table, compared
 *    bit-for-bit. These are inputs to almost everything else; if they differ,
 *    every geometry and fBm case differs too, and reporting the cause beats
 *    reporting the seventeen symptoms.
 * 2. **Battery hashes.** The full battery run against both kernels.
 * 3. **First divergent value.** For any case that differs, re-run both sides
 *    and report the index, the two doubles and their raw bit patterns. A hash
 *    mismatch alone tells you nothing about which of a million samples broke.
 */
import { canonicalBytes, sha256Hex } from '@traveller-mainworld/core';

import {
  BATTERY,
  type BatterySize,
  FULL_BATTERY,
  type BatteryResult,
  runCase,
} from './battery.js';
import type { KernelApi } from './kernelApi.js';

/**
 * Battery cases the archived twin does not implement, and so is not compared on.
 *
 * **This list is a cost, not a convenience.** ADR-0001 archived
 * `crates/kernel-wasm` rather than maintaining it, and WP10 put a crater pass in
 * the TypeScript kernel only — so `tile.composite`, which composes kernel
 * functions into a whole tile, now legitimately differs. Comparing it anyway
 * would turn `pnpm check:parity` permanently red and, worse, would train whoever
 * saw it to ignore the one check that says whether two independent
 * implementations agree.
 *
 * What is left is still the thing the ADR cites: every *kernel function* —
 * approximations, hashes, the RNG, gradient noise, fBm, the cube-sphere mapping
 * — compared bit-for-bit over the full battery. What is lost is composition
 * coverage, which is real: a kernel function can be perfectly stable while the
 * composition of them into a tile is not, and the golden fixture set is now the
 * only thing checking that. It checks it against the TypeScript kernel's own
 * past output rather than against a second implementation, which is a weaker
 * claim, and it is the claim ADR-0001 accepted when it archived the crate.
 *
 * Adding a name here is a decision about evidence. It belongs in `CHANGELOG.md`.
 */
const UNIMPLEMENTED_IN_TWIN: ReadonlySet<string> = new Set(['tile.composite']);

/** A disagreement between the two kernels. */
export interface ParityMismatch {
  readonly kind: 'constant' | 'case';
  readonly name: string;
  readonly detail: string;
}

/** One case's result on both kernels. */
export interface ParityCase {
  readonly name: string;
  readonly tsHash: string;
  readonly wasmHash: string;
  readonly samples: number;
  readonly agree: boolean;
}

export interface ParityReport {
  readonly size: BatterySize;
  readonly mismatches: readonly ParityMismatch[];
  readonly cases: readonly ParityCase[];
}

/** Raw bit pattern of a double, for failure messages. */
function bitsOf(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return `0x${view.getUint32(0).toString(16).padStart(8, '0')}${view
    .getUint32(4)
    .toString(16)
    .padStart(8, '0')}`;
}

/**
 * Locate the first index at which two runs of a case differ.
 *
 * Compares bit patterns, not values: `-0 === 0` in JavaScript, and the two hash
 * differently, so an `===` scan can report "no difference" on a case whose
 * hashes disagree. That is exactly the sort of confusing dead end this function
 * exists to avoid.
 */
function firstDivergence(a: Float64Array, b: Float64Array): string {
  if (a.length !== b.length) {
    return `lengths differ: typescript produced ${a.length} values, wasm ${b.length}`;
  }
  // Two 32-bit words per double, in host order. Endianness is irrelevant to an
  // equality scan — both arrays are in the same host's memory — and this keeps
  // the comparison to integer loads over a million samples.
  const aw = new Uint32Array(a.buffer, a.byteOffset, a.length * 2);
  const bw = new Uint32Array(b.buffer, b.byteOffset, b.length * 2);
  for (let w = 0; w < aw.length; w++) {
    if (aw[w] !== bw[w]) {
      const i = w >>> 1;
      const x = a[i]!;
      const y = b[i]!;
      return (
        `first divergence at index ${i}\n` +
        `      typescript ${x} (${bitsOf(x)})\n` +
        `      wasm       ${y} (${bitsOf(y)})`
      );
    }
  }
  // Hashes differed but every value matches: the hash function or the byte
  // encoding is at fault, not the kernels. Worth saying so explicitly.
  return 'hashes differ but every value is bit-identical — suspect canonicalBytes or sha256Hex';
}

/** Compare the constants both kernels are built on. */
function compareConstants(ts: KernelApi, wasm: KernelApi): ParityMismatch[] {
  const out: ParityMismatch[] = [];

  const tsTan = ts.tanAtOne();
  const wasmTan = wasm.tanAtOne();
  if (bitsOf(tsTan) !== bitsOf(wasmTan)) {
    out.push({
      kind: 'constant',
      name: 'TAN_AT_ONE',
      detail:
        `typescript ${tsTan} (${bitsOf(tsTan)}) vs wasm ${wasmTan} (${bitsOf(wasmTan)}).\n` +
        '    Every warped coordinate on the sphere depends on this divisor, and the seam\n' +
        '    guarantee needs tanWarp(±1) to be exactly ±1 in both kernels.',
    });
  }

  // The seam guarantee itself, asserted directly rather than inferred.
  for (const u of [1, -1, 0]) {
    const a = ts.tanWarp(u);
    const b = wasm.tanWarp(u);
    if (bitsOf(a) !== bitsOf(u) || bitsOf(b) !== bitsOf(u)) {
      out.push({
        kind: 'constant',
        name: `tanWarp(${u})`,
        detail: `must be exactly ${u}; got typescript ${a}, wasm ${b}`,
      });
    }
  }

  const tsRot = ts.octaveRotations();
  const wasmRot = wasm.octaveRotations();
  if (tsRot.length !== wasmRot.length) {
    out.push({
      kind: 'constant',
      name: 'OCTAVE_ROTATIONS',
      detail: `typescript has ${tsRot.length} entries, wasm has ${wasmRot.length}`,
    });
  } else {
    const tsHash = sha256Hex(canonicalBytes(tsRot));
    const wasmHash = sha256Hex(canonicalBytes(wasmRot));
    if (tsHash !== wasmHash) {
      out.push({
        kind: 'constant',
        name: 'OCTAVE_ROTATIONS',
        detail:
          `${firstDivergence(tsRot, wasmRot)}\n` +
          '    The table is a committed generated artefact. Regenerate the Rust copy with\n' +
          '    node scripts/gen-wasm-rotations.mjs — never by recomputing it in Rust.',
      });
    }
  }

  return out;
}

/** Run the battery against both kernels and compare. */
export function compareKernels(
  ts: KernelApi,
  wasm: KernelApi,
  size: BatterySize = FULL_BATTERY,
  onProgress?: (name: string, agree: boolean) => void,
): ParityReport {
  const mismatches: ParityMismatch[] = [...compareConstants(ts, wasm)];
  const cases: ParityCase[] = [];

  for (const c of BATTERY) {
    if (UNIMPLEMENTED_IN_TWIN.has(c.name)) {
      continue;
    }
    let tsResult: BatteryResult;
    let wasmResult: BatteryResult;
    try {
      tsResult = runCase(c, ts, size);
      wasmResult = runCase(c, wasm, size);
    } catch (err) {
      mismatches.push({
        kind: 'case',
        name: c.name,
        detail: `threw while running: ${err instanceof Error ? err.message : String(err)}`,
      });
      onProgress?.(c.name, false);
      continue;
    }

    const agree = tsResult.hash === wasmResult.hash;
    cases.push({
      name: c.name,
      tsHash: tsResult.hash,
      wasmHash: wasmResult.hash,
      samples: tsResult.samples,
      agree,
    });

    if (!agree) {
      mismatches.push({
        kind: 'case',
        name: c.name,
        detail:
          `typescript ${tsResult.hash}\n    wasm       ${wasmResult.hash}\n    ` +
          firstDivergence(c.run(ts, size), c.run(wasm, size)),
      });
    }
    onProgress?.(c.name, agree);
  }

  return { size, mismatches, cases };
}

/** Human-readable parity report. */
export function formatParityReport(report: ParityReport): string {
  if (report.mismatches.length === 0) {
    const skipped = [...UNIMPLEMENTED_IN_TWIN].join(', ');
    return (
      `Kernel parity: all ${report.cases.length} battery cases and both shared constants ` +
      'are bit-identical between the TypeScript and WASM kernels.' +
      // Named, every time. A comparison that quietly covers less than it used to
      // is worse than one that covers less and says so.
      (skipped === '' ? '' : `\nNot compared (not implemented in the archived twin): ${skipped}.`)
    );
  }
  const lines = [
    `${report.mismatches.length} kernel parity failure(s) — the two kernels disagree:`,
    '',
  ];
  for (const m of report.mismatches) {
    lines.push(`  [${m.kind}] ${m.name}`, `    ${m.detail}`, '');
  }
  lines.push(
    'One of the two kernels is wrong. Neither is privileged: check the divergent',
    'operation in both, and remember that Rust and JavaScript differ on ToInt32',
    'wrapping, Math.min/max with signed zeros, and f64::round tie-breaking.',
    'See crates/kernel-wasm/src/jsnum.rs.',
  );
  return lines.join('\n');
}
