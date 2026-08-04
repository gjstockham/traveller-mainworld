import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  analyseBrowserGraph,
  checkRepo,
  extractHtmlEntries,
  extractSpecifiers,
} from '../../../scripts/check-browser-battery.mjs';

/**
 * The guard on the browser battery's import graph.
 *
 * A checker that walks nothing reports nothing and passes forever, so the tests
 * below come in pairs: a clean graph that passes, and the same graph sabotaged
 * in the specific way the checker exists to catch. The real repo graph gets the
 * same treatment — it is walked for real, and then re-walked with a Node import
 * spliced into a module deep inside it.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** A file map standing in for the repo, so sabotage costs nothing. */
function fakeGraph(files: Record<string, string>) {
  return {
    readFile: (f: string): string | undefined => files[f],
    exists: (f: string): boolean => f in files,
  };
}

const CLEAN_FILES: Record<string, string> = {
  'web/verify.ts': `
    import { GEN_VERSION } from '@traveller-mainworld/core';
    import { runBattery } from '../src/battery.js';
    const w = new Worker(new URL('./battery.worker.ts', import.meta.url), { type: 'module' });
  `,
  'web/battery.worker.ts': `import { runBattery } from '../src/battery.js';`,
  'src/battery.ts': `import { sha256Hex } from '@traveller-mainworld/core';`,
  'packages/core/src/index.ts': `export const GEN_VERSION = '0.1.0';`,
};

describe('extractSpecifiers', () => {
  it('finds static, side-effect, dynamic and worker-URL imports', () => {
    const found = extractSpecifiers(`
      import a from './a.js';
      import './side-effect.js';
      export { b } from './b.js';
      const c = await import('./c.js');
      const w = new Worker(new URL('./d.worker.ts', import.meta.url));
    `).map((s) => s.specifier);
    expect(found.sort()).toEqual([
      './a.js',
      './b.js',
      './c.js',
      './d.worker.ts',
      './side-effect.js',
    ]);
  });

  it('reports the line an import appears on', () => {
    const found = extractSpecifiers("const x = 1;\n\nimport 'node:fs';\n");
    expect(found[0]?.line).toBe(3);
  });

  it('does not treat a type-only import as invisible', () => {
    // `import type` is erased at build time, but a type-only import of a
    // Node-only module still says the boundary was crossed in the source, and
    // it is one edit from becoming a value import.
    const found = extractSpecifiers(`import type { Manifest } from '../src/manifest.js';`);
    expect(found.map((s) => s.specifier)).toEqual(['../src/manifest.js']);
  });
});

describe('extractHtmlEntries', () => {
  it('takes module scripts, resolving package-absolute src like Vite does', () => {
    const entries = extractHtmlEntries(
      `<script type="module" src="/web/verify.ts"></script>`,
      'packages/golden/verify.html',
    );
    expect(entries).toEqual(['packages/golden/web/verify.ts']);
  });

  it('ignores classic scripts, which cannot carry imports', () => {
    const entries = extractHtmlEntries(
      `<script src="/analytics.js"></script>`,
      'packages/golden/verify.html',
    );
    expect(entries).toEqual([]);
  });
});

describe('analyseBrowserGraph', () => {
  it('passes a clean graph, having actually walked it', () => {
    const { visited, violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph(CLEAN_FILES),
    });
    expect(violations).toEqual([]);
    // The control for every sabotage below: if the walk stopped at the entry,
    // none of them would prove anything.
    expect(visited).toEqual([
      'packages/core/src/index.ts',
      'src/battery.ts',
      'web/battery.worker.ts',
      'web/verify.ts',
    ]);
  });

  it('rejects a Node builtin on the entry', () => {
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({
        ...CLEAN_FILES,
        'web/verify.ts': `${CLEAN_FILES['web/verify.ts']!}\nimport { readFileSync } from 'node:fs';`,
      }),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.specifier).toBe('node:fs');
    expect(violations[0]?.reason).toMatch(/Node builtin/);
  });

  it('rejects an unprefixed builtin, which resolves just as badly', () => {
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({ ...CLEAN_FILES, 'web/verify.ts': `import { join } from 'path';` }),
    });
    expect(violations.map((v) => v.specifier)).toEqual(['path']);
  });

  it('rejects the node-only subpath — the specific mistake this exists to catch', () => {
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({
        ...CLEAN_FILES,
        'web/verify.ts': `import { loadWasm } from '@traveller-mainworld/golden/node';`,
      }),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toMatch(/Node-only subpath/);
  });

  it('catches a builtin reached only transitively', () => {
    // The regression that matters: not the page importing fs, which nobody
    // would do, but a module several hops down acquiring one.
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({
        ...CLEAN_FILES,
        'src/battery.ts': `import { readFileSync } from 'node:fs';`,
      }),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('src/battery.ts');
  });

  it('catches a builtin reached only through the worker', () => {
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({
        ...CLEAN_FILES,
        'web/battery.worker.ts': `import { cpus } from 'node:os';`,
      }),
    });
    expect(violations.map((v) => v.file)).toEqual(['web/battery.worker.ts']);
  });

  it('reports an import that resolves to nothing rather than walking past it', () => {
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({ ...CLEAN_FILES, 'web/verify.ts': `import x from './missing.js';` }),
    });
    expect(violations[0]?.reason).toMatch(/does not resolve/);
  });

  it('rejects an unlisted third-party import', () => {
    const { violations } = analyseBrowserGraph({
      entries: ['web/verify.ts'],
      ...fakeGraph({ ...CLEAN_FILES, 'web/verify.ts': `import * as three from 'three';` }),
    });
    expect(violations[0]?.reason).toMatch(/third-party/);
  });

  it('resolves `.js` specifiers to the `.ts` sources they are written against', () => {
    const { visited, violations } = analyseBrowserGraph({
      entries: ['a.ts'],
      ...fakeGraph({ 'a.ts': `import './b.js';`, 'b.ts': '' }),
    });
    expect(violations).toEqual([]);
    expect(visited).toContain('b.ts');
  });
});

describe('the real verification page', () => {
  const analysis = checkRepo(REPO);

  it('has a browser-only import graph', () => {
    expect(analysis.violations).toEqual([]);
  });

  it('reaches the battery, the kernel and the worker', () => {
    // Pins what "clean" is a statement about. Were the walk to stop early —
    // a renamed entry, a changed HTML attribute — it would still report clean,
    // and this is what notices.
    for (const file of [
      'packages/golden/web/verify.ts',
      'packages/golden/web/battery.worker.ts',
      'packages/golden/src/battery.ts',
      'packages/golden/src/fixtures.ts',
      'packages/golden/src/fixtureManifest.ts',
      'packages/golden/src/kernelApi.ts',
      'packages/core/src/index.ts',
      'packages/core/src/kernel/approx.ts',
      'packages/core/src/tile/generator.ts',
    ]) {
      expect(analysis.visited, `${file} is not on the graph`).toContain(file);
    }
  });

  it('does not reach the Node-only modules', () => {
    expect(analysis.visited).not.toContain('packages/golden/src/wasmLoader.ts');
    expect(analysis.visited).not.toContain('packages/golden/src/cli.ts');
    // `changelog.ts` is pure and would load in a browser, but it is part of the
    // Node-side change protocol and has no business on this page.
    expect(analysis.visited).not.toContain('packages/golden/src/changelog.ts');
  });

  it('would fail if a real module on the graph acquired a Node import', () => {
    // Same walk, one file swapped for a sabotaged copy: proof that the clean
    // result above is a measurement and not a vacuous pass.
    const sabotaged = 'packages/golden/src/battery.ts';
    const { violations } = analyseBrowserGraph({
      entries: extractHtmlEntries(
        readFileSync(join(REPO, 'packages/golden/verify.html'), 'utf8'),
        'packages/golden/verify.html',
      ),
      readFile: (file) => {
        const full = join(REPO, file);
        if (!existsSync(full) || !statSync(full).isFile()) return undefined;
        const source = readFileSync(full, 'utf8');
        return file === sabotaged ? `import { readFileSync } from 'node:fs';\n${source}` : source;
      },
      exists: (file) => existsSync(join(REPO, file)) && statSync(join(REPO, file)).isFile(),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(sabotaged);
  });
});
