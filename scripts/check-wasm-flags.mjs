/**
 * Assert the WASM kernel is never built with a nondeterministic feature.
 *
 *   node scripts/check-wasm-flags.mjs
 *
 * **Relaxed-SIMD is nondeterministic by specification.** Its instructions are
 * *allowed* to choose, per invocation and per implementation, between a fused
 * and an unfused multiply-add, and between different NaN and out-of-range
 * behaviours. A module using them can produce different results on two engines
 * that are both perfectly conformant — which would quietly convert the entire
 * determinism promise into a coin flip. Fixed-width `simd128` carries no such
 * licence and is fine.
 *
 * It is off by default today. This check exists because "off by default" is a
 * property of the toolchain, not of this repository, and because enabling it is
 * exactly the sort of thing that looks like a free performance win eighteen
 * months from now.
 *
 * Two assertions, because either alone has a hole:
 *
 * 1. **Effective flags.** Ask rustc what features it would actually enable for
 *    the target under our flags (`--print cfg` reports the resolved set,
 *    including anything the target enables on its own) and reject
 *    `relaxed-simd`. This is authoritative but needs a toolchain, so it is
 *    skipped where rustc is absent.
 * 2. **Source scan.** Grep the build configuration for an enabling `+relaxed-simd`
 *    anywhere. Runs everywhere, catches the commit rather than the build, and
 *    is what protects a machine without Rust installed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ROOT, TARGET_FEATURES, WASM_TARGET as TARGET } from './wasm-config.mjs';

/** Features that must never end up enabled, with the reason for each. */
const BANNED_FEATURES = new Map([
  [
    'relaxed-simd',
    'nondeterministic by design: instructions may choose between fused and ' +
      'unfused multiply-add per implementation',
  ],
]);

/**
 * Files that can influence the build. Deliberately includes the build script
 * itself: it is the one place `-C target-feature` is set, so it is the first
 * place someone would flip the sign.
 */
const CONFIG_FILES = [
  'scripts/wasm-config.mjs',
  'scripts/build-wasm.mjs',
  'crates/kernel-wasm/Cargo.toml',
  'crates/kernel-wasm/.cargo/config.toml',
  'crates/kernel-wasm/rust-toolchain.toml',
  '.cargo/config.toml',
  '.github/workflows/ci.yml',
  // Where the twin is actually built since ADR-0001 archived it. Adding a
  // workflow that runs `pnpm wasm:build` without adding it here would move the
  // build somewhere this scan cannot see.
  '.github/workflows/wasm-parity.yml',
];

const failures = [];

// --- 1. effective flags, straight from the compiler ---------------------------

function checkEffectiveFlags() {
  const probe = spawnSync(
    'rustc',
    ['--print', 'cfg', '--target', TARGET, '-C', `target-feature=${TARGET_FEATURES}`],
    { encoding: 'utf8' },
  );

  if (probe.error?.code === 'ENOENT') {
    process.stdout.write(
      'rustc not on PATH — skipping the effective-flag probe.\n' +
        '  The source scan below still runs. CI installs a toolchain, so the\n' +
        '  authoritative check is not skipped there.\n',
    );
    return;
  }
  if (probe.status !== 0) {
    failures.push(`rustc --print cfg failed:\n${probe.stderr}`);
    return;
  }

  const enabled = new Set(
    probe.stdout
      .split('\n')
      .map((line) => /^target_feature="(.+)"$/.exec(line.trim()))
      .filter((m) => m !== null)
      .map((m) => m[1]),
  );

  for (const [feature, why] of BANNED_FEATURES) {
    if (enabled.has(feature)) {
      failures.push(`rustc would enable '${feature}' for ${TARGET} — ${why}`);
    }
  }

  process.stdout.write(
    `Effective target features for ${TARGET}: ${[...enabled].sort().join(', ') || '(none)'}\n`,
  );
}

// --- 2. source scan -----------------------------------------------------------

function checkConfigFiles() {
  let scanned = 0;
  for (const rel of CONFIG_FILES) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) continue;
    scanned++;
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [feature, why] of BANNED_FEATURES) {
        // Only an *enabling* mention is a problem: `-relaxed-simd` disables it,
        // and this file names the feature constantly.
        const enabling = new RegExp(`(^|[^-\\w])\\+?${feature}\\b`);
        const disabling = new RegExp(`-${feature}\\b`);
        if (enabling.test(line) && !disabling.test(line)) {
          failures.push(
            `${relative(ROOT, path)}:${i + 1} enables '${feature}' — ${why}\n    ${line.trim()}`,
          );
        }
      }
    });
  }
  process.stdout.write(`Scanned ${scanned} build configuration file(s).\n`);
}

// --- 3. the opt-out must actually still be there ------------------------------

function checkOptOutPresent() {
  for (const feature of BANNED_FEATURES.keys()) {
    if (!TARGET_FEATURES.split(',').includes(`-${feature}`)) {
      failures.push(
        `wasm-config.mjs no longer passes '-${feature}'. The explicit opt-out is ` +
          'what makes enabling it a reviewable edit rather than a toolchain default change.',
      );
    }
  }
}

checkEffectiveFlags();
checkConfigFiles();
checkOptOutPresent();

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} WASM build-flag problem(s):\n\n`);
  for (const f of failures) process.stderr.write(`  ${f}\n`);
  process.stderr.write(
    '\nSee crates/kernel-wasm/src/lib.rs and the spike plan §A.1 for why this matters.\n',
  );
  process.exit(1);
}

process.stdout.write('WASM build flags are clean: no nondeterministic features enabled.\n');
