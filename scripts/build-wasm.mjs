/**
 * Build `crates/kernel-wasm` for wasm32 and stage the artefact.
 *
 *   node scripts/build-wasm.mjs           release build (what parity runs on)
 *   node scripts/build-wasm.mjs --debug   debug build, for stepping through
 *
 * Output: `crates/kernel-wasm/pkg/kernel_wasm.wasm` — gitignored, because a
 * committed binary is a hash nobody can review.
 *
 * The build flags are not incidental. `-C target-feature=-relaxed-simd`
 * explicitly disables the one WASM feature that is nondeterministic by design:
 * relaxed-SIMD instructions are *permitted* to pick between a fused and an
 * unfused multiply-add per invocation, so a module using them can produce
 * different results on two engines that are both perfectly conformant. It is
 * off by default today; naming it here means turning it on takes an edit to
 * this file, which `check-wasm-flags.mjs` then rejects.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  ROOT,
  TARGET_FEATURES,
  WASM_ARTEFACT,
  WASM_TARGET as TARGET,
} from './wasm-config.mjs';

const CRATE = join(ROOT, 'crates/kernel-wasm');

const debug = process.argv.includes('--debug');
const profile = debug ? 'debug' : 'release';

const cargoArgs = ['build', '--target', TARGET];
if (!debug) cargoArgs.push('--release');

const result = spawnSync('cargo', cargoArgs, {
  cwd: CRATE,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Appended rather than replacing any inherited RUSTFLAGS, so a caller's
    // settings still apply — but this one wins, being last.
    RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-feature=${TARGET_FEATURES}`.trim(),
  },
});

if (result.error?.code === 'ENOENT') {
  process.stderr.write(
    'cargo not found on PATH.\n' +
      'Install Rust (https://rustup.rs) and add the wasm target:\n' +
      `  rustup target add ${TARGET}\n`,
  );
  process.exit(127);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const built = join(CRATE, 'target', TARGET, profile, 'kernel_wasm.wasm');
if (!existsSync(built)) {
  process.stderr.write(`cargo reported success but ${built} is missing.\n`);
  process.exit(1);
}

mkdirSync(dirname(WASM_ARTEFACT), { recursive: true });
copyFileSync(built, WASM_ARTEFACT);

process.stdout.write(`Built ${profile} wasm → ${WASM_ARTEFACT}\n`);
