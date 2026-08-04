import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The repo-root scripts must be checked out with LF line endings.
 *
 * This looks like style policing and is not. Vite's shebang stripper does not
 * handle CRLF, so a `#!/usr/bin/env node` script checked out on a Windows
 * runner keeps a bare `#` after stripping, and the moment a test imports it the
 * file fails to parse: `SyntaxError: Invalid or unexpected token`, pointing at
 * the import rather than at the script. Four scripts carry a shebang and two of
 * them are imported by tests, which is exactly how `test (windows-latest)` went
 * red on the first two CI runs while all nine browser cells were green.
 *
 * `.gitattributes` is the fix. This is the check, because the failure only
 * appears on a platform nobody here develops on, and a fix that lives entirely
 * in a config file is a fix nobody notices the loss of. Locally it is trivially
 * green; on Windows it is the whole point.
 *
 * Worth noting for the next person who reads a stack trace like that: the error
 * location is the *importing* line, so it reads as a module-resolution problem.
 * Two plausible resolution fixes were tried and neither helped, because the
 * problem was in the file's bytes and not in how it was reached.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPTS = join(REPO, 'scripts');

const scriptFiles = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'));

describe('repo-root scripts', () => {
  it('has scripts to check at all', () => {
    // A guard that scans nothing passes everything.
    expect(scriptFiles.length).toBeGreaterThan(3);
  });

  it.each(scriptFiles)('%s is free of CR characters', (file) => {
    const source = readFileSync(join(SCRIPTS, file), 'utf8');
    const line = source.slice(0, source.indexOf('\n')).length;
    expect(
      source.includes('\r'),
      `scripts/${file} contains CR. If this fails only on Windows, .gitattributes ` +
        'is not being honoured and the checkout converted LF to CRLF; a shebanged ' +
        'script in that state cannot be imported by a test. First line is ' +
        `${String(line)} characters.`,
    ).toBe(false);
  });

  it('keeps every shebang on its own clean first line', () => {
    const shebanged = scriptFiles.filter((f) =>
      readFileSync(join(SCRIPTS, f), 'utf8').startsWith('#!'),
    );
    // If this drops to zero the check above stops protecting anything, and
    // whoever removed the last shebang should know they can delete this file.
    expect(shebanged.length).toBeGreaterThan(0);
    for (const file of shebanged) {
      const source = readFileSync(join(SCRIPTS, file), 'utf8');
      expect(source.split('\n')[0], `scripts/${file} shebang`).toMatch(/^#![^\r]*$/);
    }
  });
});
