/**
 * Cepheus Engine — the Size table.
 *
 * **OPEN GAME CONTENT.** The Size codes, diameters and surface gravities below
 * are derived from the Cepheus Engine System Reference Document and are used
 * under the Open Game License 1.0a. See `LICENSE-OGL.txt` at the repository
 * root for the licence and its Section 15 declarations.
 *
 * ## What the rules say, and what they do not
 *
 * Cepheus reads Size as roughly 1,600 km of diameter per point, so radius is
 * `code × 800 km`, and pairs each code with a surface gravity. Those two
 * columns are the rules'.
 *
 * The other three are not, and no tabletop ruleset has an opinion about them:
 * peak-to-trough relief, base noise frequency, and octave count. They live
 * here anyway, because they are per-Size constants that decide what a world
 * looks like, and a table a ruleset owns is a better home for them than magic
 * numbers inside the assembler — retuning relief for a fictional-physics
 * reason is exactly as much of an identity event as retuning gravity, and this
 * way it is treated as one.
 *
 * ## Where the relief figures came from
 *
 * They are the Phase 0 fixture amplitudes, unchanged, and they are the one set
 * of numbers in this file that were derived against real bodies rather than
 * chosen. The argument is in `CHANGELOG.md` under the `289a78e5…` fixture set,
 * and the short version is that **absolute relief is roughly flat across the
 * size range** — Luna 20 km, Mars 30 km, Earth 20 km, Venus 14 km — because
 * maximum relief is set by material strength against gravity rather than by
 * radius. Relief *as a fraction of radius* falls, and only because the radius
 * grows.
 *
 * Reusing them exactly is deliberate: the ten golden fixtures are built from
 * this table (see `packages/core/src/fixtures.ts`), so the interpreted radius
 * and relief of an airless Size N world are the pinned Phase 0 values to the
 * bit, and landing the interpreter moves no golden hash.
 *
 * ## Size 0
 *
 * A belt, not a body — PRD §3 makes it a permanent non-goal, and the app
 * refuses it. The row exists because `interpret` must be **total** over every
 * valid UPP and the parser accepts Size 0 by design (product scope is not the
 * parser's job). The figures are what the rules imply for a planetoid — under
 * 1,000 km across, negligible gravity — and the zero gravity is real: it is
 * why `minSurfaceGravityG` exists, and why there is a finiteness test.
 */
import type { SizeRow } from '../ruleset.js';

/** Rows in code order; `rowFor` asserts that ordering rather than assuming it. */
export const SIZE_ROWS: readonly SizeRow[] = [
  { code: 0, radiusKm: 400, surfaceGravityG: 0.0, terrainAmplitudeM: 8000, fbmFrequency: 0.6, fbmOctaves: 6 },
  { code: 1, radiusKm: 800, surfaceGravityG: 0.05, terrainAmplitudeM: 14000, fbmFrequency: 0.8, fbmOctaves: 7 },
  { code: 2, radiusKm: 1600, surfaceGravityG: 0.15, terrainAmplitudeM: 17000, fbmFrequency: 1.0, fbmOctaves: 8 },
  { code: 3, radiusKm: 2400, surfaceGravityG: 0.25, terrainAmplitudeM: 19000, fbmFrequency: 1.2, fbmOctaves: 9 },
  { code: 4, radiusKm: 3200, surfaceGravityG: 0.35, terrainAmplitudeM: 28000, fbmFrequency: 1.4, fbmOctaves: 9 },
  { code: 5, radiusKm: 4000, surfaceGravityG: 0.45, terrainAmplitudeM: 26000, fbmFrequency: 1.6, fbmOctaves: 10 },
  { code: 6, radiusKm: 4800, surfaceGravityG: 0.7, terrainAmplitudeM: 24000, fbmFrequency: 1.8, fbmOctaves: 10 },
  { code: 7, radiusKm: 5600, surfaceGravityG: 0.9, terrainAmplitudeM: 21000, fbmFrequency: 2.0, fbmOctaves: 11 },
  { code: 8, radiusKm: 6400, surfaceGravityG: 1.0, terrainAmplitudeM: 20000, fbmFrequency: 2.2, fbmOctaves: 11 },
  { code: 9, radiusKm: 7200, surfaceGravityG: 1.25, terrainAmplitudeM: 18000, fbmFrequency: 2.4, fbmOctaves: 12 },
  { code: 10, radiusKm: 8000, surfaceGravityG: 1.4, terrainAmplitudeM: 17000, fbmFrequency: 2.6, fbmOctaves: 12 },
];
