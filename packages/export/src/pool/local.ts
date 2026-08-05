/**
 * A {@link BandWorker} that renders on the calling thread.
 *
 * Two uses, and both are real:
 *
 * - **The fallback.** A host with no `Worker` — Node, an older browser, a
 *   locked-down embed — still exports, just on one core. The pool code is
 *   identical either way, so the fallback is exercised by every test rather than
 *   being a path that only runs on the day it is needed.
 * - **The reference.** `pool.test.ts` renders the same map through one of these
 *   and through several, and asserts the images are byte-identical. That is what
 *   turns "bands are independent" from an argument in a comment into a check.
 */
import { BandRenderer } from '../render.js';
import type { ExportJob } from '../job.js';
import { CHANNELS } from '../raster.js';
import type { BandWorker } from './pool.js';

/** A pool worker backed by a {@link BandRenderer} on this thread. */
export class LocalBandWorker implements BandWorker {
  private readonly renderer: BandRenderer;
  private readonly rowBytes: number;

  constructor(private readonly job: ExportJob) {
    this.renderer = new BandRenderer(job);
    this.rowBytes = job.size.width * CHANNELS;
  }

  render(row0: number, rows: number): Promise<Uint8Array> {
    // A fresh buffer per band rather than a reused one: the pool holds the
    // result until it has pasted it, and handing back a buffer that the next
    // call overwrites is the kind of aliasing bug that shows as a band of the
    // wrong latitude appearing twice.
    const pixels = new Uint8Array(rows * this.rowBytes);
    this.renderer.render(row0, rows, pixels);
    return Promise.resolve(pixels);
  }

  dispose(): void {
    // Nothing to release: the renderer's scratch is garbage like anything else
    // once this object is dropped. The method exists because the interface has
    // it and a worker-backed implementation genuinely needs it.
  }

  /** The job this worker renders. Handy in tests. */
  get exportJob(): ExportJob {
    return this.job;
  }
}
