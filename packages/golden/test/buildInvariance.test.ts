import { describe, expect, it } from 'vitest';

import {
  BUILD_ORDER,
  BUILD_PROFILES,
  INVARIANCE_PROFILES,
  VIEWER_BUILD_CONTRACT,
} from '../build-profiles.mjs';
import { loadRepoScript } from './loadRepoScript.js';

const { checkRepo, checkViewerBuildContract } =
  await loadRepoScript<typeof import('../../../scripts/check-build-invariance.mjs')>(
    'scripts/check-build-invariance.mjs',
  );

/**
 * A checker that checks nothing passes everything, so this drives the guard
 * against synthetic repositories — including sabotaged ones — as well as the
 * real one.
 */
const cleanRepo = {
  read: (file: string) =>
    file === 'packages/viewer/package.json'
      ? JSON.stringify({ scripts: { build: 'vite build' } })
      : undefined,
  exists: () => false,
};

describe('build profiles', () => {
  it('builds the profile that empties dist-web first', () => {
    // The others write inside it; any other order leaves a half-built tree that
    // a cell would then report hashes from.
    expect(BUILD_ORDER[0]).toBe('matrix');
    expect(BUILD_PROFILES['matrix']!.outDir).toBe('dist-web');
    for (const name of BUILD_ORDER.slice(1)) {
      expect(BUILD_PROFILES[name]!.outDir.startsWith('dist-web/')).toBe(true);
    }
  });

  it('covers every profile, and the matrix drives exactly one of them', () => {
    expect(new Set([...INVARIANCE_PROFILES, 'matrix'])).toEqual(new Set(BUILD_ORDER));
    expect(INVARIANCE_PROFILES).not.toContain('matrix');
  });

  it('differs from the matrix profile in a way that could actually change output', () => {
    // Three identical builds would pass forever and prove nothing.
    const matrix = BUILD_PROFILES['matrix']!;
    for (const name of INVARIANCE_PROFILES) {
      const profile = BUILD_PROFILES[name]!;
      expect(
        profile.minify !== matrix.minify || profile.target !== matrix.target,
        `profile '${name}' is configured identically to 'matrix'`,
      ).toBe(true);
    }
  });

  it('serves every profile from a distinct url', () => {
    const urls = BUILD_ORDER.map((n) => BUILD_PROFILES[n]!.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('the viewer build contract', () => {
  it('passes against the real repository', () => {
    expect(checkRepo()).toEqual([]);
  });

  it('passes a viewer that takes Vite defaults', () => {
    expect(checkViewerBuildContract(cleanRepo)).toEqual([]);
  });

  it('fails when the viewer acquires a Vite config', () => {
    const violations = checkViewerBuildContract({
      ...cleanRepo,
      exists: (file: string) => file === 'packages/viewer/vite.config.ts',
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toMatch(/no longer uses Vite's defaults/);
  });

  it('fails when the viewer build script changes', () => {
    const violations = checkViewerBuildContract({
      ...cleanRepo,
      read: () => JSON.stringify({ scripts: { build: 'vite build --mode production' } }),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toMatch(/build script is/);
  });

  it('fails when the viewer package manifest is missing entirely', () => {
    expect(checkViewerBuildContract({ read: () => undefined, exists: () => false })).toEqual([
      { path: `${VIEWER_BUILD_CONTRACT.packageDir}/package.json`, reason: 'does not exist' },
    ]);
  });
});
