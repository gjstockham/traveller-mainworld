/**
 * Transcribe `packages/core/src/kernel/rotations.ts` into
 * `crates/kernel-wasm/src/rotations.rs`.
 *
 *   node scripts/gen-wasm-rotations.mjs          write the file
 *   node scripts/gen-wasm-rotations.mjs --check  fail if it is out of date (CI)
 *
 * The rotation table is itself a generated artefact: `gen-rotations.mjs` builds
 * it with trig, which the kernel may not call at runtime, and commits the
 * literals. Recomputing it in Rust would therefore be recomputing a *committed
 * output* — and Rust's `sin`/`cos` are not V8's, so the two kernels would
 * layer their fBm octaves along different axes and diverge everywhere. Copying
 * by hand is no better: 216 doubles is exactly the volume at which a
 * transposition survives review.
 *
 * So the Rust table is derived mechanically from the TypeScript one, and CI
 * checks the derivation is current. Both languages parse decimal literals with
 * correct rounding, so the same string denotes the same double in each.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TS_PATH = join(ROOT, 'packages/core/src/kernel/rotations.ts');
const RS_PATH = join(ROOT, 'crates/kernel-wasm/src/rotations.rs');

/** Pull `MAX_OCTAVES` and the flat rotation array out of the TypeScript source. */
function parseTs(source) {
  const maxMatch = /export const MAX_OCTAVES = (\d+);/.exec(source);
  if (!maxMatch) {
    throw new Error('could not find MAX_OCTAVES in rotations.ts');
  }
  const arrayMatch = /new Float64Array\(\[([\s\S]*?)\]\)/.exec(source);
  if (!arrayMatch) {
    throw new Error('could not find the OCTAVE_ROTATIONS array literal in rotations.ts');
  }

  // Strip line comments (`// octave 3`) before splitting, so the octave labels
  // do not become entries.
  const body = arrayMatch[1].replace(/\/\/[^\n]*/g, '');
  const values = body
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { maxOctaves: Number(maxMatch[1]), values };
}

/**
 * Re-emit a JavaScript numeric literal as a Rust one.
 *
 * The two grammars agree on decimal and exponent forms, but Rust requires a
 * digit either side of the point and rejects a bare integer where an `f64` is
 * expected. Anything this does not recognise is an error rather than a
 * best-effort rewrite: silently mangling one constant out of 216 is the exact
 * failure mode the script exists to prevent.
 */
function toRustLiteral(js) {
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(js)) {
    throw new Error(`unrecognised numeric literal in rotations.ts: ${JSON.stringify(js)}`);
  }
  let out = js;
  if (out.startsWith('.')) out = `0${out}`;
  if (out.startsWith('-.')) out = `-0${out.slice(1)}`;
  // Give every value a fractional part so the literal is unambiguously f64.
  if (!/[.e]/i.test(out)) out = `${out}.0`;
  if (out.endsWith('.')) out = `${out}0`;
  return out;
}

function render({ maxOctaves, values }) {
  const expected = maxOctaves * 9;
  if (values.length !== expected) {
    throw new Error(`expected ${expected} rotation values, parsed ${values.length}`);
  }

  const lines = [];
  for (let o = 0; o < maxOctaves; o++) {
    const row = values.slice(o * 9, o * 9 + 9).map(toRustLiteral);
    lines.push(`    // octave ${o}`);
    lines.push(`    ${row.join(', ')},`);
  }

  return `//! Per-octave rotation matrices for fBm. GENERATED FILE — do not edit.
//!
//! Regenerate with: node scripts/gen-wasm-rotations.mjs
//!
//! Transcribed from \`packages/core/src/kernel/rotations.ts\`, which is itself
//! generated (by \`scripts/gen-rotations.mjs\`, which may use trig freely because
//! its output is committed as literals). This file must never be produced by
//! recomputing the matrices in Rust: \`f64::sin\` is not V8's \`Math.sin\`, so the
//! two kernels would rotate their octaves differently and every fBm sample
//! would diverge.
//!
//! Layout: ${maxOctaves} matrices, 9 doubles each, row-major, flattened.

/// Number of rotation matrices available; caps the usable octave count.
pub const MAX_OCTAVES: i32 = ${maxOctaves};

pub const OCTAVE_ROTATIONS: [f64; ${expected}] = [
${lines.join('\n')}
];
`;
}

const parsed = parseTs(readFileSync(TS_PATH, 'utf8'));
const rendered = render(parsed);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(RS_PATH, 'utf8');
  } catch {
    /* treated as out of date below */
  }
  if (current !== rendered) {
    process.stderr.write(
      `${RS_PATH} is out of date with respect to rotations.ts.\n` +
        'Regenerate it with: node scripts/gen-wasm-rotations.mjs\n',
    );
    process.exit(1);
  }
  process.stdout.write(`rotations.rs is current (${parsed.maxOctaves} octaves)\n`);
} else {
  writeFileSync(RS_PATH, rendered);
  process.stdout.write(`Wrote ${RS_PATH} (${parsed.maxOctaves} octaves)\n`);
}
