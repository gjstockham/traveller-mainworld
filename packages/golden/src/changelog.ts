/**
 * The third of the change protocol (implementation plan §7.4c, restated in
 * CHANGELOG.md — which is the copy that is in version control).
 *
 * An intentional output change needs three things in the same PR: a version
 * bump or a fixture-spec change, a regenerated manifest, and a changelog entry
 * saying what changed and why. The first two have been enforced since WP1 —
 * `golden:update` refuses without a bump. The third was documented and
 * unenforced, and an unenforced third of a protocol is the third that gets
 * skipped.
 *
 * So the gate lives here, at the moment the manifest is written, rather than in
 * a CI step comparing against a merge base. That is deliberate: this repository
 * is developed by committing to `main`, so a pull-request diff check would
 * never fire. `golden:update` is the one place a hash can legitimately move,
 * and it is the same mechanism the version bump already uses.
 *
 * The logic is pure and the file read is injected, because a checker that reads
 * nothing passes everything — see `test/changelog.test.ts`.
 */

/** One thing the changelog has to name before a manifest may be written. */
export interface ChangelogRequirement {
  /** What this identity is, for the failure message. */
  readonly label: string;
  /**
   * How it must appear. `heading` demands a `## <value>` section — the shape a
   * version release takes. `mention` demands the text appear anywhere, which is
   * what a fixture-spec hash needs, since it belongs inside an existing
   * version's section rather than opening one of its own.
   */
  readonly kind: 'heading' | 'mention';
  readonly value: string;
  /** Suggested prose for the failure message. */
  readonly suggestion: string;
}

/** Whether the changelog opens a `## <version>` section. */
export function hasVersionHeading(changelog: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The lookahead, not `\b`: `\b` sits happily between the `2` and the `.` of
  // `## 0.2.0`, so searching for `0.2` would match a section for `0.2.0` and a
  // prerelease heading would satisfy a requirement for the release.
  return new RegExp(`^##\\s+v?${escaped}(?![\\w.-])`, 'm').test(changelog);
}

/**
 * Check a changelog against the requirements of a manifest write.
 *
 * @returns a message explaining what to add, or `undefined` if the write may
 *          proceed.
 */
export function checkChangelog(
  changelog: string | undefined,
  requirements: readonly ChangelogRequirement[],
  path = 'CHANGELOG.md',
): string | undefined {
  if (requirements.length === 0) {
    return undefined;
  }
  if (changelog === undefined) {
    return (
      `${path} does not exist, and the change protocol requires an entry in the same commit ` +
      `as a regenerated manifest (implementation plan §7.4c). Create it and record:\n\n` +
      requirements.map((r) => `  - ${r.suggestion}`).join('\n')
    );
  }

  const missing = requirements.filter((r) =>
    r.kind === 'heading' ? !hasVersionHeading(changelog, r.value) : !changelog.includes(r.value),
  );
  if (missing.length === 0) {
    return undefined;
  }

  const lines = [
    `${path} does not record ${missing.length === 1 ? 'this change' : 'these changes'}, and the`,
    'change protocol requires the entry in the same commit as the regenerated manifest',
    '(implementation plan §7.4c). Add:',
    '',
  ];
  for (const r of missing) {
    lines.push(
      `  - ${r.label}: ${r.kind === 'heading' ? `a '## ${r.value}' section` : `the text '${r.value}'`}`,
      `      ${r.suggestion}`,
    );
  }
  lines.push(
    '',
    'The entry is the half of the protocol that says *why*. A manifest diff shows',
    'that hashes moved; only the changelog says whether that was intended.',
  );
  return lines.join('\n');
}
