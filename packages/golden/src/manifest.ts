/**
 * Manifest comparison.
 *
 * The manifest is the committed record of what the kernel produces. A mismatch
 * is either a real regression or an intentional change — and an intentional
 * change requires, in the same PR, a generator version bump plus a regenerated
 * manifest, so the diff makes silent drift impossible.
 */
import { type BatteryResult, batteryDigest } from './battery.js';

export interface Manifest {
  /** Generator version these hashes were produced under. */
  readonly genVersion: string;
  /** Digest over all case hashes — the single value to eyeball. */
  readonly digest: string;
  /** Per-case hashes, keyed by case name. */
  readonly cases: Readonly<Record<string, { readonly hash: string; readonly samples: number }>>;
}

export interface Mismatch {
  readonly name: string;
  readonly expected: string | undefined;
  readonly actual: string | undefined;
  readonly reason: 'differs' | 'missing-from-manifest' | 'missing-from-run';
}

/** Build a manifest from a battery run. */
export function buildManifest(genVersion: string, results: readonly BatteryResult[]): Manifest {
  const cases: Record<string, { hash: string; samples: number }> = {};
  for (const r of results) {
    cases[r.name] = { hash: r.hash, samples: r.samples };
  }
  return { genVersion, digest: batteryDigest(results), cases };
}

/**
 * Compare a run against a manifest.
 *
 * Reports cases present on only one side as well as differing hashes: a case
 * silently disappearing from the battery would otherwise look like a pass.
 */
export function compareToManifest(
  manifest: Manifest,
  results: readonly BatteryResult[],
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    seen.add(r.name);
    const expected = manifest.cases[r.name];
    if (expected === undefined) {
      mismatches.push({
        name: r.name,
        expected: undefined,
        actual: r.hash,
        reason: 'missing-from-manifest',
      });
    } else if (expected.hash !== r.hash) {
      mismatches.push({
        name: r.name,
        expected: expected.hash,
        actual: r.hash,
        reason: 'differs',
      });
    }
  }

  for (const name of Object.keys(manifest.cases)) {
    if (!seen.has(name)) {
      mismatches.push({
        name,
        expected: manifest.cases[name]!.hash,
        actual: undefined,
        reason: 'missing-from-run',
      });
    }
  }

  return mismatches;
}

/** Human-readable mismatch report for CI output. */
export function formatMismatches(mismatches: readonly Mismatch[]): string {
  if (mismatches.length === 0) {
    return 'All battery hashes match the manifest.';
  }
  const lines = [`${mismatches.length} battery mismatch(es):`, ''];
  for (const m of mismatches) {
    switch (m.reason) {
      case 'differs':
        lines.push(`  ${m.name}`, `    expected ${m.expected}`, `    actual   ${m.actual}`);
        break;
      case 'missing-from-manifest':
        lines.push(`  ${m.name}: new case, not in manifest (regenerate it)`);
        break;
      case 'missing-from-run':
        lines.push(`  ${m.name}: in manifest but not produced by this run`);
        break;
    }
  }
  lines.push(
    '',
    'If this change is intentional it needs, in the SAME PR: a generator',
    'version bump, a regenerated manifest, and a changelog entry.',
  );
  return lines.join('\n');
}
