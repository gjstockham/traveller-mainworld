import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Load one of the repo-root `scripts/*.mjs` checkers from a test.
 *
 * A plain `import '../../../scripts/check-x.mjs'` works on Linux and macOS and
 * **fails on Windows**, which is what the first CI run on `windows-latest`
 * found: both files that did it died with `SyntaxError: Invalid or unexpected
 * token` pointing at the import statement. The specifier escapes the package
 * directory, Vite serves it through `/@fs/`, and the drive letter in an absolute
 * Windows path does not survive that round trip — so the test received a 404
 * HTML page and Node parsed `<!DOCTYPE` as JavaScript. Within the package the
 * identical pattern is fine, which is why `../build-profiles.mjs` next door
 * never complained.
 *
 * So this bypasses the bundler's resolver entirely: an absolute `file://` URL
 * through a dynamic import, which Vite cannot statically analyse and therefore
 * leaves to Node's own ESM loader. The type parameter carries the module's
 * shape across, taken from the hand-written `.d.mts` via a type-only `import`
 * that is erased before anything runs.
 *
 * The scripts stay plain ESM at the repo root because `pnpm lint` runs them
 * before anything is built, so they cannot live in a package's `dist/`. That
 * constraint is what puts them outside the package in the first place.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export async function loadRepoScript<T>(repoRelativePath: string): Promise<T> {
  const url = pathToFileURL(join(REPO, repoRelativePath)).href;
  return (await import(/* @vite-ignore */ url)) as T;
}
