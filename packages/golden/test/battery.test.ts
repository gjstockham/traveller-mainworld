import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEN_VERSION } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { EDGE_VALUES, adversarialArray, nextAfter } from '../src/adversarial.js';
import { BATTERY, SAMPLES, batteryDigest, runBattery, runCase } from '../src/battery.js';
import {
  type Manifest,
  buildManifest,
  compareToManifest,
  formatMismatches,
} from '../src/manifest.js';

const MANIFEST: Manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../manifest.json'), 'utf8'),
) as Manifest;

describe('nextAfter', () => {
  it('steps exactly one ulp', () => {
    expect(nextAfter(1, true)).toBe(1 + Number.EPSILON);
    expect(nextAfter(1, false)).toBe(1 - Number.EPSILON / 2);
    expect(nextAfter(0, true)).toBe(Number.MIN_VALUE);
  });

  it('produces a value strictly between the original and two ulps away', () => {
    for (const v of [1, 1e-300, 1e300, 0.1, 12345.678]) {
      const up = nextAfter(v, true);
      expect(up).toBeGreaterThan(v);
      expect(nextAfter(up, false)).toBe(v);
    }
  });
});

describe('adversarial inputs', () => {
  it('includes signed zeros, denormals and the normal boundary', () => {
    const vals = adversarialArray(2000);
    const has = (p: (x: number) => boolean): boolean => vals.some(p);
    expect(has((x) => Object.is(x, -0)), 'negative zero').toBe(true);
    expect(has((x) => x === Number.MIN_VALUE), 'smallest denormal').toBe(true);
    expect(has((x) => x === 2.2250738585072014e-308), 'smallest normal').toBe(true);
    expect(has((x) => x === Number.MAX_VALUE), 'max value').toBe(true);
    expect(EDGE_VALUES.length).toBeGreaterThan(30);
  });

  it('is deterministic', () => {
    expect(Array.from(adversarialArray(5000))).toEqual(Array.from(adversarialArray(5000)));
  });

  it('never yields NaN or infinity', () => {
    const vals = adversarialArray(50_000);
    expect(vals.every((v) => Number.isFinite(v) || v === 0)).toBe(true);
  });

  it('straddles integer boundaries where the noise lattice cell changes', () => {
    const vals = Array.from(adversarialArray(3000));
    expect(vals).toContain(nextAfter(7, true));
    expect(vals).toContain(nextAfter(7, false));
  });
});

describe('battery composition', () => {
  it('covers every kernel area', () => {
    const names = BATTERY.map((c) => c.name);
    for (const prefix of ['ops.', 'hash.', 'rng.', 'approx.', 'noise.', 'geometry.', 'tile.']) {
      expect(names.some((n) => n.startsWith(prefix)), `no case for ${prefix}`).toBe(true);
    }
  });

  it('has unique case names', () => {
    const names = BATTERY.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('samples at least 1e6 values per case', () => {
    // The spike plan's bar. Enforced here so a case cannot quietly shrink.
    for (const [name, entry] of Object.entries(MANIFEST.cases)) {
      expect(entry.samples, name).toBeGreaterThanOrEqual(SAMPLES);
    }
  });
});

describe('manifest comparison', () => {
  const results = [
    { name: 'a', hash: 'h1', samples: 10 },
    { name: 'b', hash: 'h2', samples: 10 },
  ];
  const manifest = buildManifest('1.0.0', results);

  it('reports a clean run', () => {
    expect(compareToManifest(manifest, results)).toEqual([]);
    expect(formatMismatches([])).toMatch(/All battery hashes match/);
  });

  it('detects a changed hash', () => {
    const changed = [{ ...results[0]! }, { ...results[1]!, hash: 'DIFFERENT' }];
    const m = compareToManifest(manifest, changed);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ name: 'b', reason: 'differs', expected: 'h2' });
    expect(formatMismatches(m)).toMatch(/version bump/);
  });

  it('detects a case vanishing from the run', () => {
    // Without this check, deleting a failing case would look like a pass.
    const m = compareToManifest(manifest, [results[0]!]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ name: 'b', reason: 'missing-from-run' });
  });

  it('detects a case new to the manifest', () => {
    const m = compareToManifest(manifest, [...results, { name: 'c', hash: 'h3', samples: 10 }]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ name: 'c', reason: 'missing-from-manifest' });
  });

  it('digest changes when any case hash changes', () => {
    const other = [{ ...results[0]! }, { ...results[1]!, hash: 'x' }];
    expect(batteryDigest(other)).not.toBe(batteryDigest(results));
  });
});

describe('the committed manifest', () => {
  it('is for the current generator version', () => {
    expect(MANIFEST.genVersion).toBe(GEN_VERSION);
  });

  it('lists exactly the cases the battery defines', () => {
    expect(Object.keys(MANIFEST.cases).sort()).toEqual(BATTERY.map((c) => c.name).sort());
  });

  it('matches a full battery run on this platform', { timeout: 300_000 }, () => {
    // The determinism promise, checked end to end on the reference platform.
    // The cross-browser and cross-OS legs of this same comparison are WP4.
    const results = runBattery();
    const mismatches = compareToManifest(MANIFEST, results);
    expect(formatMismatches(mismatches)).toMatch(/All battery hashes match/);
    expect(batteryDigest(results)).toBe(MANIFEST.digest);
  });

  it('is stable across repeated runs in one process', { timeout: 120_000 }, () => {
    // Catches state leaking between runs — a generator holding module-level
    // mutable state would show up here and nowhere else.
    //
    // A subset, not the whole battery: the stateful components are the PRNG and
    // the tile generator, and running those twice proves the point in a few
    // seconds where the full battery costs thirty. CI's dedicated golden job
    // (WP7) re-runs everything anyway.
    const stateful = BATTERY.filter(
      (c) => c.name.startsWith('rng.') || c.name.startsWith('tile.'),
    );
    expect(stateful.length).toBeGreaterThan(2);
    const a = stateful.map((c) => runCase(c).hash);
    const b = stateful.map((c) => runCase(c).hash);
    expect(b).toEqual(a);
  });
});
