#!/usr/bin/env node
/**
 * Independent enforcement of the kernel op whitelist.
 *
 * ESLint already bans these operations (eslint.config.js), but an
 * `eslint-disable` comment would silently open a hole in the determinism
 * guarantee. This script does not honour eslint-disable, so both have to be
 * defeated to get a banned op into a golden hash.
 *
 * Checks, over packages/core/src/kernel:
 *   1. no banned transcendentals / Math.random / Date / Intl / ** operator
 *   2. no eslint-disable comments at all
 *   3. no imports that leave the kernel zone
 *
 * And over crates/kernel-wasm/src (the Rust twin):
 *   4. no libm calls, and no operation whose rounding differs from the JS one
 *   5. no dependencies
 *
 * The Rust half is not a copy of the same worry. Rust's libm on wasm32 is
 * perfectly deterministic — the same bytes execute the same way everywhere —
 * which is precisely the trap: the twin's job is to agree with the *TypeScript*
 * kernel, and the TypeScript kernel evaluates polynomials. A `f64::sin` here
 * would pass every WASM-only determinism test and still be wrong.
 *
 * See docs/plans/phase0-implementation-plan.md §2.3 and §3 (WP3).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL_DIR = join(REPO_ROOT, 'packages/core/src/kernel');
const WASM_CRATE_DIR = join(REPO_ROOT, 'crates/kernel-wasm/src');
const WASM_CRATE_MANIFEST = join(REPO_ROOT, 'crates/kernel-wasm/Cargo.toml');

const BANNED_MATH = [
  'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1',
  'log', 'log2', 'log10', 'log1p',
  'pow', 'cbrt', 'hypot',
  'random',
];

const PATTERNS = [
  {
    // Word boundary after the name stops `Math.log` matching `Math.log2` twice
    // and, more importantly, stops `exp` matching `expm1`.
    re: new RegExp(`\\bMath\\s*\\.\\s*(${BANNED_MATH.join('|')})\\b`, 'g'),
    describe: (m) => `Math.${m[1]} is not bit-identical across JS engines`,
  },
  {
    re: /\*\*=?/g,
    describe: () => 'the ** operator resolves to Math.pow semantics; use powi()',
  },
  {
    re: /\bnew\s+Date\b|\bDate\s*\.\s*now\b/g,
    describe: () => 'Date makes generation time-dependent',
  },
  {
    re: /\bIntl\s*\./g,
    describe: () => 'Intl is locale-dependent',
  },
  {
    // Only actual directive comments, not prose mentioning the word.
    re: /(?:\/\/|\/\*)\s*eslint-disable/g,
    describe: () =>
      'eslint-disable is not permitted in the kernel — it would bypass the op whitelist',
  },
];

/** Strip comments so prose about `Math.sin` does not trip the scan. */
function stripComments(src) {
  // Replace with spaces rather than nothing, to keep line/column offsets intact.
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Rust float methods banned in the twin, with the reason each one is wrong.
 *
 * Split into two groups because they fail for different reasons, and conflating
 * them would make the second group look like superstition.
 */
const BANNED_RUST = [
  // Group 1 — libm. Deterministic within WASM, but not the same function the
  // TypeScript evaluates, so the twin would diverge in the last bits.
  ...['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2'].map((n) => [
    n,
    `libm ${n}() is not the polynomial approximation approx.ts evaluates`,
  ]),
  ...['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'].map((n) => [
    n,
    `libm ${n}() has no counterpart in the TypeScript kernel`,
  ]),
  ...['exp', 'exp2', 'exp_m1', 'ln', 'ln_1p', 'log', 'log2', 'log10'].map((n) => [
    n,
    `libm ${n}() has no counterpart in the TypeScript kernel`,
  ]),
  ['powf', 'libm powf() is not the multiply sequence powi() performs'],
  ['powi', "f64::powi is an LLVM intrinsic free to reorder multiplies; use ops::powi"],
  ['cbrt', 'libm cbrt() has no counterpart in the TypeScript kernel'],
  ['hypot', 'libm hypot() has no counterpart in the TypeScript kernel'],

  // Group 2 — operations that exist in both languages and round differently.
  // These are the quiet ones: they look like faithful translations.
  [
    'mul_add',
    'mul_add is a fused multiply-add — one rounding where JavaScript has two',
  ],
  [
    'round',
    "f64::round breaks ties away from zero; Math.round breaks them toward +Infinity, so they differ at -0.5",
  ],
  [
    'clamp',
    'f64::clamp panics on NaN and orders signed zeros differently from Math.min/Math.max; use ops::clamp',
  ],
  [
    'min',
    'f64::min may return either operand for ±0 and swallows NaN; use jsnum::js_min',
  ],
  [
    'max',
    'f64::max may return either operand for ±0 and swallows NaN; use jsnum::js_max',
  ],
];

function* walk(dir, ext = '.ts') {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full, ext);
    } else if (entry.endsWith(ext)) {
      yield full;
    }
  }
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

const violations = [];

function report(file, src, index, message) {
  violations.push(`${relative(REPO_ROOT, file)}:${lineOf(src, index)}  ${message}`);
}

for (const file of walk(KERNEL_DIR)) {
  const raw = readFileSync(file, 'utf8');
  // eslint-disable comments must be caught even though they live in comments,
  // so scan the raw source for those and the stripped source for everything else.
  const stripped = stripComments(raw);

  for (const { re, describe } of PATTERNS) {
    const haystack = re.source.includes('eslint-disable') ? raw : stripped;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(haystack)) !== null) {
      report(file, haystack, m.index, describe(m));
    }
  }

  // Import-zone check: the kernel may only import from within itself.
  const importRe = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = importRe.exec(stripped)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) {
      report(file, stripped, m.index, `kernel may not import the bare specifier '${spec}'`);
      continue;
    }
    const target = resolve(dirname(file), spec);
    if (!target.startsWith(KERNEL_DIR)) {
      report(file, stripped, m.index, `import '${spec}' escapes the kernel zone`);
    }
  }
}

// --- the Rust twin -----------------------------------------------------------

/**
 * Rust line comments (`//`, `///`, `//!`) only. Block comments are not used in
 * this crate, and the doc comments talk about the banned functions constantly.
 */
function stripRustComments(src) {
  return src.replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Everything from the first `#[cfg(test)]` onward.
 *
 * Tests are allowed the banned functions, and one of them needs them: the
 * accuracy tests in `approx.rs` compare `tan_core` against `f64::tan` on
 * purpose, which is the cheapest way to catch a mistyped coefficient. Shipping
 * code always precedes the test module in this crate, so the first occurrence
 * is a sound cut.
 */
function shippingCodeOnly(src) {
  const cut = src.indexOf('#[cfg(test)]');
  return cut === -1 ? src : src.slice(0, cut);
}

let rustFilesScanned = 0;
for (const file of walk(WASM_CRATE_DIR, '.rs')) {
  rustFilesScanned++;
  const src = shippingCodeOnly(stripRustComments(readFileSync(file, 'utf8')));

  for (const [name, why] of BANNED_RUST) {
    // Method-call position only: `x.sin()`. A local named `min` or a struct
    // field is not a float operation, and flagging it would train people to
    // work around the check rather than read it.
    const re = new RegExp(`\\.\\s*${name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      report(file, src, m.index, `.${name}() — ${why}`);
    }
  }

  // Free-function forms: `f64::sin(x)`, and the libm crate if it ever appears.
  const pathRe = /\b(?:f64|f32|libm)\s*::\s*(\w+)\s*\(/g;
  const bannedNames = new Set(BANNED_RUST.map(([n]) => n));
  let m;
  while ((m = pathRe.exec(src)) !== null) {
    if (bannedNames.has(m[1])) {
      report(file, src, m.index, `f64::${m[1]}() is banned in the twin`);
    }
  }
}

// The crate must stay dependency-free. A dependency is code whose float
// behaviour nobody in this repository has read, linked into the one place that
// cannot tolerate a surprise.
if (statSync(WASM_CRATE_MANIFEST).isFile()) {
  const manifest = readFileSync(WASM_CRATE_MANIFEST, 'utf8');
  const section = /\n\[dependencies\]([\s\S]*?)(?=\n\[|$)/.exec(manifest);
  const entries = (section?.[1] ?? '')
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l.length > 0);
  if (entries.length > 0) {
    violations.push(
      `${relative(REPO_ROOT, WASM_CRATE_MANIFEST)}  kernel-wasm must stay dependency-free, ` +
        `found: ${entries.join(', ')}`,
    );
  }
}

if (violations.length > 0) {
  console.error(`\nKernel whitelist violations (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nSee docs/plans/phase0-implementation-plan.md §2.3 and §3 (WP3).\n');
  process.exit(1);
}

console.log(`Kernel whitelist: clean (TypeScript kernel + ${rustFilesScanned} Rust twin files).`);
