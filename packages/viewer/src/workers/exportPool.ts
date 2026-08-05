/**
 * The browser's half of the export pool: a `BandWorker` backed by a real
 * `Worker`.
 *
 * `packages/export` owns the scheduling, the ordering, the progress accounting
 * and the failure handling, and it owns them behind an interface rather than
 * behind a `Worker` — which is what lets all of that be tested in Node against a
 * `LocalBandWorker`. This file is the adapter, and it is the only part of the
 * export path that cannot be checked here.
 *
 * ## The fallback is not decoration
 *
 * A host with no `Worker` — an older browser, a locked-down embed, a Node
 * script — still exports, on one core, through `LocalBandWorker`. That path is
 * exercised by every test in `packages/export`, so it is not a branch that only
 * runs on the day it is needed.
 */
import type { ExportJob } from '@traveller-mainworld/export';
import {
  type BandWorker,
  type ExportResponse,
  LocalBandWorker,
} from '@traveller-mainworld/export';

/**
 * How many workers to spawn.
 *
 * One per hardware thread, capped. Uncapped, a 32-thread machine would spawn 32
 * copies of a basin field and 32 crater-candidate scratches for a job that is
 * memory-bandwidth-bound long before it is core-bound; and the last band still
 * has to finish, so past a point the extra workers only add startup cost. The
 * floor of 2 is because `hardwareConcurrency` is allowed to lie downward.
 */
export function poolSize(): number {
  const reported = typeof navigator === 'undefined' ? 0 : (navigator.hardwareConcurrency ?? 0);
  return Math.max(2, Math.min(8, reported || 4));
}

/** A pool worker backed by a module `Worker`. */
class WorkerBandWorker implements BandWorker {
  private readonly worker: Worker;
  private nextRequest = 1;
  /** In-flight request, by id. The pool never runs two on one worker. */
  private pending:
    | { id: number; resolve: (pixels: Uint8Array) => void; reject: (error: Error) => void }
    | undefined;

  constructor(job: ExportJob) {
    this.worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<ExportResponse>): void => {
      const reply = event.data;
      const waiting = this.pending;
      if (waiting === undefined || waiting.id !== reply.requestId) {
        // Not a case the pool can produce, and silence here would be a hang.
        return;
      }
      this.pending = undefined;
      if (reply.type === 'failed') {
        waiting.reject(new Error(`export worker failed: ${reply.message}`));
      } else {
        waiting.resolve(reply.pixels);
      }
    };
    this.worker.onerror = (event): void => {
      // A worker that dies mid-band would otherwise leave the pool waiting
      // forever, on a progress bar that has simply stopped.
      this.pending?.reject(new Error(`export worker crashed: ${event.message}`));
      this.pending = undefined;
    };
    // The job goes once, at start, so only band coordinates cross per request.
    this.worker.postMessage({ type: 'begin', job });
  }

  render(row0: number, rows: number): Promise<Uint8Array> {
    const id = this.nextRequest++;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending = { id, resolve, reject };
      this.worker.postMessage({ type: 'band', requestId: id, row0, rows });
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}

/**
 * Spawn a pool for `job`.
 *
 * Falls back to a single on-thread worker where `Worker` is not available. The
 * caller does not branch: `renderWithPool` takes whatever comes back.
 */
export function spawnExportPool(job: ExportJob, count = poolSize()): BandWorker[] {
  if (typeof Worker === 'undefined') {
    return [new LocalBandWorker(job)];
  }
  return Array.from({ length: count }, () => new WorkerBandWorker(job));
}
