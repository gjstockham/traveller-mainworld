#!/usr/bin/env node
/**
 * Builds the verification page under every bundler profile, into one tree that
 * a single `vite preview` can serve.
 *
 * Order is load-bearing: the `matrix` profile empties `dist-web/`, and the
 * others write inside it. `BUILD_ORDER` in `build-profiles.mjs` is where that
 * is recorded; this script just obeys it, and fails loudly rather than leaving
 * a half-built tree that a cell would then report hashes from.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD_ORDER, BUILD_PROFILES } from './build-profiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

for (const name of BUILD_ORDER) {
  const profile = BUILD_PROFILES[name];
  const label =
    `${name} (target ${profile.target ?? 'vite default'}, ` +
    `minify ${profile.minify === false ? 'off' : 'vite default'})`;
  console.log(`\n▸ building verify.html — ${label}`);

  const result = spawnSync('vite', ['build'], {
    cwd: HERE,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GOLDEN_BUILD_PROFILE: name },
  });
  if (result.status !== 0) {
    console.error(`\nBuild profile '${name}' failed.`);
    process.exit(result.status ?? 1);
  }

  const built = join(HERE, profile.outDir, 'verify.html');
  if (!existsSync(built)) {
    console.error(`\nBuild profile '${name}' reported success but ${built} does not exist.`);
    process.exit(1);
  }
}

console.log(`\nBuilt ${BUILD_ORDER.length} profiles into dist-web/.`);
