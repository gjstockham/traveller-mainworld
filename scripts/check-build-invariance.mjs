#!/usr/bin/env node
/**
 * Keeps the build-invariance cell pointed at the bundle that actually ships.
 *
 * The `viewer-profile` in `packages/golden/build-profiles.mjs` claims to build
 * the verification page the way `packages/viewer` builds itself, so that the
 * invariance cell tests the pipeline the viewer's generated output goes through.
 * That claim rests on one fact and nothing else: the viewer has no Vite config,
 * so it takes Vite's defaults, and the profile takes them too.
 *
 * The moment the viewer acquires a config or a non-default build script, the
 * profile stops mirroring it — silently, with the cell still green. That is the
 * failure mode from WP6, where archiving the WASM parity job moved `pnpm
 * wasm:build` into a workflow the flag scanner did not read and took its
 * coverage with it. So the mirror is asserted rather than assumed.
 *
 * Run from `pnpm lint`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIEWER_BUILD_CONTRACT } from '../packages/golden/build-profiles.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Checks the contract against a repo. `read`/`exists` are injected for the unit test. */
export function checkViewerBuildContract({ read, exists }) {
  const { packageDir, buildScript, forbiddenFiles } = VIEWER_BUILD_CONTRACT;
  const violations = [];

  for (const file of forbiddenFiles) {
    const path = `${packageDir}/${file}`;
    if (exists(path)) {
      violations.push({
        path,
        reason:
          `${packageDir} now has a Vite config, so its build no longer uses Vite's defaults. ` +
          "The golden page's 'viewer-profile' claims to mirror it and no longer does — copy " +
          "the config's build options into BUILD_PROFILES['viewer-profile'] in " +
          'packages/golden/build-profiles.mjs, or say there why the mirror is not needed.',
      });
    }
  }

  const manifestPath = `${packageDir}/package.json`;
  const source = read(manifestPath);
  if (source === undefined) {
    violations.push({ path: manifestPath, reason: 'does not exist' });
    return violations;
  }

  const actual = JSON.parse(source).scripts?.build;
  if (actual !== buildScript) {
    violations.push({
      path: manifestPath,
      reason:
        `build script is '${actual ?? '(none)'}', expected '${buildScript}'. The golden page's ` +
        "'viewer-profile' mirrors a plain `vite build`; if the viewer builds differently now, " +
        'update BUILD_PROFILES and VIEWER_BUILD_CONTRACT in packages/golden/build-profiles.mjs.',
    });
  }

  return violations;
}

/** The real repo, read off disk. */
export function checkRepo(repoRoot = REPO) {
  return checkViewerBuildContract({
    read: (file) => {
      const full = join(repoRoot, file);
      return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
    },
    exists: (file) => existsSync(join(repoRoot, file)),
  });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const violations = checkRepo();
  if (violations.length > 0) {
    console.error(
      'The build-invariance cell no longer mirrors how the viewer is bundled:\n',
    );
    for (const v of violations) {
      console.error(`  ${v.path}\n    ${v.reason}`);
    }
    console.error(
      "\nSee packages/golden/build-profiles.mjs and the 'viewer-profile' entry.",
    );
    process.exit(1);
  }
  console.log(
    "Build-invariance profiles current: packages/viewer still builds under Vite's defaults.",
  );
}
