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
 * See docs/plans/phase0-implementation-plan.md §2.3.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL_DIR = join(REPO_ROOT, 'packages/core/src/kernel');

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

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (entry.endsWith('.ts')) {
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

if (violations.length > 0) {
  console.error(`\nKernel whitelist violations (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nSee docs/plans/phase0-implementation-plan.md §2.3.\n');
  process.exit(1);
}

console.log('Kernel whitelist: clean.');
