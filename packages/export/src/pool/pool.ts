/**
 * Rendering a map across a pool of workers, by row bands.
 *
 * ## Why a pool at all
 *
 * Plan §8 estimates ~2.5 µs per sample from Spike B's 2466 ns/vertex at ten
 * octaves, giving ~21 s single-threaded for a 4096×2048 map "before craters".
 * **Craters exist now**, and WP10's warmed medians work out at roughly 4.3–7.6 µs
 * per sample — 36–64 s for the same map, and the point path has no lattice cache
 * to amortise, so probably worse. Those medians are Node under WSL2 rather than
 * the target laptop and through no bench harness, so they are not evidence; they
 * are enough to say the plan's figure is optimistic and that this is not
 * optional. Exports have no R13 interactivity budget, but a silent
 * thirty-second freeze is still a bug.
 *
 * ## Why the pool is abstract
 *
 * {@link BandWorker} is an interface, not a `Worker`. The viewer supplies one
 * backed by a real module worker; `pool.test.ts` supplies one backed by a
 * `BandRenderer` on this thread. That is the same seam `tileJob.ts` makes for
 * the tile generator, made for the same reason ADR-0001 gives: **a seam nothing
 * exercises is a comment.** The scheduling, the ordering, the progress
 * accounting and the failure handling are all in this file, all tested in Node,
 * and none of them care whether the far side is a thread.
 *
 * ## Ordering, and why bands can arrive in any order
 *
 * A band's pixels are a pure function of the band. Nothing in `BandRenderer`
 * carries state between bands except scratch that is rebuilt per call, so bands
 * may be rendered in any order, on any number of workers, and pasted into the
 * image as they land. `pool.test.ts` asserts the pooled image is byte-identical
 * to the single-threaded one at several pool sizes — which is the property that
 * makes the parallelism free rather than a source of nondeterminism.
 */
import type { ExportJob } from '../job.js';
import { type Raster, allocateRaster } from '../raster.js';
import { CHANNELS } from '../raster.js';
import { DEFAULT_BAND_ROWS, type RenderProgress } from '../render.js';

/**
 * One rendering worker, as the pool needs it.
 *
 * `render` must resolve with exactly `rows · width · 3` bytes, and may be called
 * again as soon as it resolves. The pool never calls it concurrently on one
 * worker, which is what lets an implementation hold a single `BandRenderer`.
 */
export interface BandWorker {
  /** Render rows `[row0, row0 + rows)`. */
  render(row0: number, rows: number): Promise<Uint8Array>;
  /** Release whatever the worker holds. Called once, after the last band. */
  dispose(): void;
}

export interface PoolOptions {
  readonly bandRows?: number;
  readonly onProgress?: (progress: RenderProgress) => void;
  /**
   * Abort the render.
   *
   * Checked between bands. An export the user has walked away from should stop
   * costing them a core, and a pool with no way to stop is a pool that renders
   * the whole of a map somebody cancelled at 3%.
   */
  readonly signal?: { readonly aborted: boolean };
}

/** Thrown when {@link PoolOptions.signal} aborts a render. */
export class ExportAborted extends Error {
  constructor(rows: number, total: number) {
    super(`export aborted after ${String(rows)} of ${String(total)} rows`);
    this.name = 'ExportAborted';
  }
}

/**
 * Render a whole map across `workers`.
 *
 * Workers are driven as a work queue rather than given a contiguous slice each:
 * bands are not equal in cost — a polar band's basin cull keeps almost nothing
 * while an equatorial one keeps a dozen basins — so a static split leaves one
 * worker running long after the rest have finished.
 */
export async function renderWithPool(
  job: ExportJob,
  workers: readonly BandWorker[],
  options: PoolOptions = {},
): Promise<Raster> {
  if (workers.length === 0) {
    throw new Error('an export pool needs at least one worker');
  }

  const bandRows = options.bandRows ?? DEFAULT_BAND_ROWS;
  const rowBytes = job.size.width * CHANNELS;
  const raster = allocateRaster(job.size);

  // The queue, as a cursor. Every worker takes the next band when it is free.
  let nextRow = 0;
  let doneRows = 0;
  let aborted = false;

  const takeBand = (): { row0: number; rows: number } | undefined => {
    if (nextRow >= job.size.height) {
      return undefined;
    }
    const row0 = nextRow;
    const rows = Math.min(bandRows, job.size.height - row0);
    nextRow = row0 + rows;
    return { row0, rows };
  };

  const drive = async (worker: BandWorker): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted === true) {
        aborted = true;
        return;
      }
      const band = takeBand();
      if (band === undefined) {
        return;
      }
      const pixels = await worker.render(band.row0, band.rows);
      const expected = band.rows * rowBytes;
      if (pixels.length < expected) {
        throw new Error(
          `worker returned ${String(pixels.length)} bytes for rows ` +
            `${String(band.row0)}..${String(band.row0 + band.rows)}, expected ${String(expected)}`,
        );
      }
      raster.data.set(pixels.subarray(0, expected), band.row0 * rowBytes);
      doneRows += band.rows;
      options.onProgress?.({ rows: doneRows, total: job.size.height });
    }
  };

  try {
    await Promise.all(workers.map((worker) => drive(worker)));
  } finally {
    for (const worker of workers) {
      worker.dispose();
    }
  }

  if (aborted) {
    throw new ExportAborted(doneRows, job.size.height);
  }
  return raster;
}
