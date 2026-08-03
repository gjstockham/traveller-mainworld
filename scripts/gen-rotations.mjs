#!/usr/bin/env node
/**
 * Generates packages/core/src/kernel/rotations.ts.
 *
 * fBm rotates the sampling coordinate between octaves so that the octave
 * lattices do not stay axis-aligned with each other — without it, layered
 * gradient noise shows visible grid-aligned ridging.
 *
 * Building those matrices needs sin/cos, which are banned inside the kernel.
 * The way out is that they are *constants*: computed once here, committed as
 * literals, and never recomputed at runtime. This script may use whatever it
 * likes; its output is data.
 *
 * Run: node scripts/gen-rotations.mjs
 *
 * The generated file is committed. Re-running it must reproduce byte-identical
 * output — if it ever does not, that is an output-affecting change and needs a
 * generator version bump under the golden-hash change protocol.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/core/src/kernel/rotations.ts',
);

/** Maximum octaves any world will use. Generous: deep LOD adds octaves with depth. */
const MAX_OCTAVES = 24;

/** Golden angle. Successive multiples never come close to repeating. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Axis for octave i, from the Fibonacci sphere: a low-discrepancy sequence, so
 * successive octave axes are well separated rather than clustering.
 */
function axisFor(i, n) {
  // Offset by half a step so the sequence never lands exactly on a pole. The
  // naive i/(n-1) form puts octave 0 on (0,1,0), giving a rotation about Y
  // that leaves the y coordinate untouched — precisely the axis alignment
  // these rotations exist to avoid.
  const y = 1 - (2 * i + 1) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

/** Rodrigues' rotation formula → a 3×3 matrix, row-major. */
function rotationMatrix([ax, ay, az], angle) {
  const len = Math.hypot(ax, ay, az);
  const x = ax / len;
  const y = ay / len;
  const z = az / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

const rows = [];
for (let i = 0; i < MAX_OCTAVES; i++) {
  // Angle is deliberately not a multiple of π/2: axis-aligned rotations would
  // defeat the purpose by mapping the lattice onto itself.
  const m = rotationMatrix(axisFor(i, MAX_OCTAVES), 0.7 + GOLDEN_ANGLE * i);
  // Round-trip through the shortest representation that reads back identically,
  // so the committed literals are exactly the doubles used at runtime.
  rows.push(m.map((v) => String(v)).join(', '));
}

const body = rows.map((r, i) => `  // octave ${i}\n  ${r},`).join('\n');

const source = `/**
 * Per-octave rotation matrices for fBm. GENERATED FILE — do not edit.
 *
 * Regenerate with: node scripts/gen-rotations.mjs
 *
 * These exist as constants because building them needs sin/cos, which the
 * kernel may not call. Computing them offline and committing the literals
 * keeps the runtime path free of transcendentals. Changing these values
 * changes generated terrain, so it requires a generator version bump and a
 * regenerated golden manifest.
 *
 * Layout: ${MAX_OCTAVES} matrices, 9 doubles each, row-major, flattened.
 */

/** Number of rotation matrices available; caps the usable octave count. */
export const MAX_OCTAVES = ${MAX_OCTAVES};

export const OCTAVE_ROTATIONS = new Float64Array([
${body}
]);
`;

writeFileSync(OUT, source);
console.log(`Wrote ${MAX_OCTAVES} rotation matrices to ${OUT}`);
