#!/usr/bin/env node
/**
 * Keeps the browser battery path free of Node.
 *
 * `packages/golden` splits its exports deliberately: `.` is platform-neutral so
 * the battery can be bundled for a browser, and the one `node:fs`-dependent
 * module sits behind `./node`. Nothing enforces that split. A bundler would
 * fail on `node:fs` eventually, but by then the failure is a stack trace during
 * a build, or — worse — a working bundle that silently pulled in a shim and is
 * no longer running the same code as the Node reference run.
 *
 * So this walks the verification page's import graph from its HTML entry
 * through every relative and workspace import it reaches, and fails on anything
 * that cannot exist in a browser. Transitive by construction: the interesting
 * regression is not `verify.ts` importing `node:fs`, which nobody would do, but
 * a module deep in `core` or `golden/src` acquiring one and quietly joining the
 * graph.
 *
 * Run from `pnpm lint`. Exports its analysis for the unit test in
 * packages/golden/test/browserBattery.test.ts, because a checker that walks
 * nothing passes everything.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The page whose graph must stay browser-only. Entries are read out of it. */
export const HTML_ENTRY = 'packages/golden/verify.html';

/** Node builtins, with and without the `node:` prefix. */
const BUILTIN = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto', 'dgram', 'diagnostics_channel',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os',
  'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

/** Workspace packages, resolved to source so the walk continues into them. */
const WORKSPACE_PREFIX = '@traveller-mainworld/';

/**
 * Module specifiers that may appear in the graph without being walked.
 *
 * Kept as an explicit list rather than "any bare specifier": a new third-party
 * dependency on the verification page is a decision, not a detail, and it
 * should have to be written down here.
 */
const ALLOWED_BARE = new Set([]);

/**
 * Extracts module specifiers from JavaScript or TypeScript source.
 *
 * A regex rather than a parser, which means it can over-match inside a string
 * literal or a comment. That direction is safe: the failure mode is a spurious
 * violation someone has to look at, not a missed one. It matches `new URL(...,
 * import.meta.url)` too, because that is how a worker joins the graph and
 * missing it would leave the worker's imports unchecked.
 */
export function extractSpecifiers(source) {
  const found = [];
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      // Line of the specifier itself, not of the match: the patterns swallow a
      // leading separator, and a multi-line import statement should point at
      // the module it names rather than at the brace it opened with.
      const at = match.index + match[0].lastIndexOf(match[1]);
      found.push({ specifier: match[1], line: source.slice(0, at).split('\n').length });
    }
  }
  return found;
}

/** Module scripts referenced by an HTML entry, as repo-relative paths. */
export function extractHtmlEntries(html, htmlPath) {
  const entries = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/g)) {
    const src = match[1];
    if (!/\btype\s*=\s*['"]module['"]/.test(match[0])) continue;
    // Vite roots the package directory, so an absolute src is package-relative.
    const packageDir = posix.dirname(htmlPath);
    entries.push(src.startsWith('/') ? posix.join(packageDir, src.slice(1)) : posix.join(packageDir, src));
  }
  return entries;
}

/**
 * Walks the graph and reports what may not be in it.
 *
 * `readFile` and `exists` are injected so the analysis can be unit-tested
 * against a synthetic file map — including sabotaged ones, which is the only
 * way to know this reports anything at all.
 */
export function analyseBrowserGraph({ entries, readFile, exists }) {
  const violations = [];
  const visited = new Set();
  const queue = [...entries.map((file) => ({ file, from: '(entry)' }))];

  const resolveRelative = (specifier, importer) => {
    const base = posix.join(posix.dirname(importer), specifier);
    // TypeScript sources are written with `.js` specifiers; the bundler maps
    // them back. Try the candidates in the order a bundler would.
    const candidates = [
      base,
      base.replace(/\.js$/, '.ts'),
      `${base}.ts`,
      posix.join(base, 'index.ts'),
    ];
    return candidates.find((candidate) => exists(candidate));
  };

  while (queue.length > 0) {
    const { file, from } = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    if (file.endsWith('.json')) continue;

    const source = readFile(file);
    if (source === undefined) {
      violations.push({
        file: from,
        specifier: file,
        line: 0,
        reason: 'a file on the browser import graph does not exist',
      });
      continue;
    }

    for (const { specifier, line } of extractSpecifiers(source)) {
      const bare = specifier.replace(/^node:/, '');
      if (specifier.startsWith('node:') || BUILTIN.has(bare)) {
        violations.push({
          file,
          specifier,
          line,
          reason: `'${specifier}' is a Node builtin and cannot load in a browser`,
        });
        continue;
      }

      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(specifier, file);
        if (resolved === undefined) {
          violations.push({
            file,
            specifier,
            line,
            reason: `'${specifier}' does not resolve to a file`,
          });
          continue;
        }
        queue.push({ file: resolved, from: file });
        continue;
      }

      if (specifier.startsWith(WORKSPACE_PREFIX)) {
        const [name, ...rest] = specifier.slice(WORKSPACE_PREFIX.length).split('/');
        const subpath = rest.join('/');
        if (subpath === 'node') {
          violations.push({
            file,
            specifier,
            line,
            reason:
              `'${specifier}' is the Node-only subpath — it exists precisely so it stays off ` +
              'this graph. Move what you need into the platform-neutral entry.',
          });
          continue;
        }
        if (subpath !== '') {
          violations.push({
            file,
            specifier,
            line,
            reason: `'${specifier}' uses an unknown subpath; only the package root is browser-safe`,
          });
          continue;
        }
        queue.push({ file: `packages/${name}/src/index.ts`, from: file });
        continue;
      }

      if (!ALLOWED_BARE.has(specifier)) {
        violations.push({
          file,
          specifier,
          line,
          reason:
            `'${specifier}' is a third-party import on the verification page. If it belongs ` +
            'there, add it to ALLOWED_BARE in this script with a reason.',
        });
      }
    }
  }

  return { visited: [...visited].sort(), violations };
}

/** The real graph, read off disk. */
export function checkRepo(repoRoot = REPO) {
  const read = (file) => {
    const full = join(repoRoot, file);
    return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
  };
  const html = read(HTML_ENTRY);
  if (html === undefined) {
    throw new Error(`${HTML_ENTRY} does not exist; the verification page is the entry point.`);
  }
  return analyseBrowserGraph({
    entries: extractHtmlEntries(html, HTML_ENTRY),
    readFile: read,
    exists: (file) => isFile(join(repoRoot, file)),
  });
}

function isFile(full) {
  return existsSync(full) && statSync(full).isFile();
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { visited, violations } = checkRepo();
  if (violations.length > 0) {
    console.error(
      `${violations.length} import(s) on the browser battery graph cannot run in a browser:\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}\n    ${v.reason}`);
    }
    console.error(
      '\nThe verification page must run the same battery as the Node reference,\n' +
        'unshimmed. See README "The determinism battery".',
    );
    process.exit(1);
  }
  console.log(
    `Browser battery graph clean: ${visited.length} modules from ${HTML_ENTRY}, ` +
      'no Node builtins, no node-only subpaths.',
  );
}
