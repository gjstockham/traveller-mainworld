/**
 * Where a run's results are allowed to go.
 *
 * Its own module so it can be tested. WP14 lost `results/phase0.md` to a
 * `pnpm bench:quick` and got it back only because `git status` happened to be
 * read afterwards; the fix then was a separate filename for quick runs, which
 * left the full run still pointed at the same file. This is the rest of that
 * fix, and an untested guard over a file ADR-0001 cites is not much of a guard.
 */
import { join } from 'node:path';

/** Phase written when nothing says otherwise. */
export const DEFAULT_PHASE = 1;

export interface ResolvedOutput {
  readonly path: string;
  readonly phase: number;
}

/**
 * Resolve the results path from the command line.
 *
 * `--phase=0` is refused rather than supported. `phase0.md` records a machine, a
 * generator version and a tile that no longer exist — its single-tile row had no
 * crater pass in it — so there is no run that reproduces it and every run that
 * targets it destroys it. `--out=` remains for anyone who genuinely means to
 * write somewhere specific, because a guard with no way past it gets removed.
 */
export function resolveOutput(argv: readonly string[], resultsDir: string): ResolvedOutput {
  const quick = argv.includes('--quick');
  const flag = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  };

  const raw = flag('phase');
  const phase = raw === undefined ? DEFAULT_PHASE : Number(raw);
  if (!Number.isInteger(phase) || phase < 0) {
    throw new Error(`--phase must be a non-negative integer, got ${String(raw)}`);
  }

  const out = flag('out');
  if (phase === 0 && out === undefined) {
    throw new Error(
      'refusing to write phase0.md: it is WP5\'s record of a generator and a tile that no ' +
        'longer exist, and ADR-0001 §E2 cites it as the evidence the kernel decision was made ' +
        'on. Nothing here reproduces it. Pass --out= if you really mean to write a file.',
    );
  }

  const name = out ?? `phase${String(phase)}${quick ? '-quick' : ''}.md`;
  return { path: join(resultsDir, name), phase };
}
