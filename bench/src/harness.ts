/**
 * Timing harness.
 *
 * A benchmark that is easy to write is usually one that measures the wrong
 * thing, so the defences here are deliberate rather than decorative:
 *
 * * **Warm-up.** V8 interprets, then baseline-compiles, then optimises. Timing
 *   the first few calls measures the interpreter and reports a number two
 *   orders of magnitude off.
 * * **A sink.** An optimiser is entitled to delete a call whose result is never
 *   used, and "0.00 ms per tile" is exactly what that looks like. Every
 *   workload returns a value that is folded into {@link sink} and printed, so
 *   the work provably happened.
 * * **Median and p95, not mean.** GC pauses and scheduler noise are one-sided:
 *   they only ever make a sample slower. A mean lets one 40 ms pause dominate
 *   thirty clean samples; the median ignores it and the p95 says how often it
 *   happens.
 * * **The minimum is reported too.** For a deterministic workload the fastest
 *   sample is the closest to the machine's true cost, with the least
 *   interference. If min and median diverge sharply, the machine is busy and
 *   the numbers should be distrusted.
 */

/**
 * Accumulator that makes results observable, so nothing can be optimised away.
 *
 * Deliberately module-level and deliberately printed at the end of a run: a
 * value written to a local variable and never read is still dead code.
 */
export const sink = { value: 0 };

/** Fold a result into the sink. Cheap enough not to distort a millisecond-scale sample. */
export function consume(x: number): void {
  sink.value += x;
}

export interface TimingOptions {
  /** Iterations discarded before measurement, to let the JIT settle. */
  readonly warmup?: number;
  /** Timed iterations. */
  readonly iterations?: number;
  /** Operations performed per iteration, so per-op figures are meaningful. */
  readonly opsPerIteration?: number;
}

export interface Timing {
  readonly name: string;
  /** Milliseconds per iteration. */
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly iterations: number;
  readonly opsPerIteration: number;
  /** Milliseconds per operation, from the median. */
  readonly msPerOp: number;
  /** Operations per second, from the median. */
  readonly opsPerSecond: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  // Nearest-rank. With 20-50 samples, interpolating between order statistics
  // implies a precision the sample size does not support.
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/**
 * Time `fn` and summarise the distribution.
 *
 * `fn` must return a number derived from its work — see {@link sink}.
 */
export function time(name: string, fn: () => number, options: TimingOptions = {}): Timing {
  const warmup = options.warmup ?? 3;
  const iterations = options.iterations ?? 15;
  const opsPerIteration = options.opsPerIteration ?? 1;

  for (let i = 0; i < warmup; i++) {
    consume(fn());
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    const result = fn();
    samples.push(performance.now() - started);
    consume(result);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = quantile(sorted, 0.5);

  return {
    name,
    minMs: sorted[0]!,
    medianMs,
    p95Ms: quantile(sorted, 0.95),
    iterations,
    opsPerIteration,
    msPerOp: medianMs / opsPerIteration,
    opsPerSecond: (opsPerIteration * 1000) / medianMs,
  };
}

/**
 * Time an async `fn`. Same treatment, for the worker-pool measurements.
 */
export async function timeAsync(
  name: string,
  fn: () => Promise<number>,
  options: TimingOptions = {},
): Promise<Timing> {
  const warmup = options.warmup ?? 1;
  const iterations = options.iterations ?? 5;
  const opsPerIteration = options.opsPerIteration ?? 1;

  for (let i = 0; i < warmup; i++) {
    consume(await fn());
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    const result = await fn();
    samples.push(performance.now() - started);
    consume(result);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = quantile(sorted, 0.5);

  return {
    name,
    minMs: sorted[0]!,
    medianMs,
    p95Ms: quantile(sorted, 0.95),
    iterations,
    opsPerIteration,
    msPerOp: medianMs / opsPerIteration,
    opsPerSecond: (opsPerIteration * 1000) / medianMs,
  };
}

/** Format a duration with a sensible number of significant figures. */
export function ms(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  if (x >= 1) return x.toFixed(2);
  return x.toFixed(3);
}

/** Format a byte count in the largest unit that keeps it readable. */
export function bytes(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1024) return `${n.toFixed(0)} B`;
  if (abs < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (abs < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}
