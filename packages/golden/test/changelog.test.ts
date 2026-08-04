import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEN_VERSION } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { type ChangelogRequirement, checkChangelog, hasVersionHeading } from '../src/changelog.js';
import { fixtureSpecHash } from '../src/fixtures.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const CHANGELOG = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');

const versionRequirement = (value: string): ChangelogRequirement => ({
  label: 'generator version',
  kind: 'heading',
  value,
  suggestion: `## ${value} — what changed`,
});

const mentionRequirement = (value: string): ChangelogRequirement => ({
  label: 'fixture set',
  kind: 'mention',
  value,
  suggestion: `fixture set \`${value}…\``,
});

describe('hasVersionHeading', () => {
  it('finds a section for the version', () => {
    expect(hasVersionHeading('## 0.2.0 — notes\n', '0.2.0')).toBe(true);
    expect(hasVersionHeading('## v0.2.0\n', '0.2.0')).toBe(true);
  });

  it('does not accept a mention that is not a heading', () => {
    // "bumped to 0.2.0" in prose under someone else's heading is not an entry.
    expect(hasVersionHeading('Bumped to 0.2.0 in this PR.\n', '0.2.0')).toBe(false);
  });

  it('does not let one version satisfy another by prefix', () => {
    expect(hasVersionHeading('## 0.2.01\n', '0.2.0')).toBe(false);
    expect(hasVersionHeading('## 0.2.0\n', '0.2')).toBe(false);
  });
});

describe('checkChangelog', () => {
  it('passes when there is nothing to require', () => {
    expect(checkChangelog(undefined, [])).toBeUndefined();
  });

  it('refuses when the file does not exist at all', () => {
    const complaint = checkChangelog(undefined, [versionRequirement('0.2.0')]);
    expect(complaint).toMatch(/does not exist/);
    expect(complaint).toContain('0.2.0');
  });

  it('refuses when the version has no section, and says what to add', () => {
    const complaint = checkChangelog('# Changelog\n\n## 0.1.0\n', [versionRequirement('0.2.0')]);
    expect(complaint).toMatch(/'## 0\.2\.0' section/);
  });

  it('refuses when a required mention is absent', () => {
    const complaint = checkChangelog('# Changelog\n\n## 0.1.0\n', [mentionRequirement('abc123')]);
    expect(complaint).toContain('abc123');
  });

  it('reports every missing requirement at once, not the first', () => {
    const complaint = checkChangelog('# Changelog\n', [
      versionRequirement('0.2.0'),
      mentionRequirement('abc123'),
    ]);
    expect(complaint).toContain('0.2.0');
    expect(complaint).toContain('abc123');
  });

  it('lets a satisfied changelog through', () => {
    const text = '# Changelog\n\n## 0.2.0 — kernel\n\n- fixture set `abc123…` changed\n';
    expect(
      checkChangelog(text, [versionRequirement('0.2.0'), mentionRequirement('abc123')]),
    ).toBeUndefined();
  });
});

describe('the committed CHANGELOG', () => {
  it('has a section for the current generator version', () => {
    // The gate only fires when a manifest is regenerated. This asserts the file
    // is actually in the state the gate would demand, so a missing entry is
    // found by the suite rather than by whoever next bumps the version.
    expect(hasVersionHeading(CHANGELOG, GEN_VERSION)).toBe(true);
  });

  it('names the committed fixture set', () => {
    expect(CHANGELOG).toContain(fixtureSpecHash().slice(0, 16));
  });

  it('states the change protocol, since the implementation plan is not in version control', () => {
    expect(CHANGELOG).toMatch(/change protocol/i);
    expect(CHANGELOG).toContain('golden:update');
  });
});
