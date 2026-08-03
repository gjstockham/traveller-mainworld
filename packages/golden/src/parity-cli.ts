/**
 * Run the full determinism battery against both kernels and require the hashes
 * to match each other.
 *
 *   node dist/parity-cli.js            full battery (the WP3 acceptance run)
 *   node dist/parity-cli.js --quick    reduced sizes, for a fast local check
 *
 * A missing `.wasm` is a hard failure here, not a skip. The unit-test parity
 * case skips when the artefact is absent so that a clone without Rust can still
 * run `pnpm test`; this entry point is what CI uses, and it must not be capable
 * of passing without having compared anything.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

import { FULL_BATTERY, QUICK_BATTERY } from './battery.js';
import { tsKernelApi, wasmKernelApi } from './kernelApi.js';
import { compareKernels, formatParityReport } from './parity.js';
import { WASM_ARTEFACT_PATH, loadWasmKernel } from './wasmLoader.js';

async function run(): Promise<number> {
  const quick = process.argv.includes('--quick');
  const size = quick ? QUICK_BATTERY : FULL_BATTERY;

  process.stdout.write(
    `Kernel parity: TypeScript vs Rust/WASM (generator ${GEN_VERSION}` +
      `${quick ? ', quick sizes' : ''})\n`,
  );
  process.stdout.write(`  wasm module: ${WASM_ARTEFACT_PATH}\n\n`);

  const wasm = wasmKernelApi(await loadWasmKernel());
  const ts = tsKernelApi();

  const started = Date.now();
  const report = compareKernels(ts, wasm, size, (name, agree) => {
    process.stdout.write(`  ${agree ? 'ok  ' : 'FAIL'}  ${name}\n`);
  });
  process.stdout.write(`\nCompared in ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);

  process.stdout.write(`${formatParityReport(report)}\n`);
  return report.mismatches.length === 0 ? 0 : 1;
}

run().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
