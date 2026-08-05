/**
 * The worker side of the pool, with the platform taken as a parameter.
 *
 * `viewer/src/workers/exportWorker.ts` is four lines around this: it wires
 * `self.onmessage` and `self.postMessage` in and does nothing else. Keeping the
 * message handling here rather than there means the state machine — a `begin`
 * before any `band`, one renderer for the life of the worker, a failure reported
 * rather than thrown into the void — is Node-testable, which is the whole reason
 * the split exists.
 */
import { BandRenderer } from '../render.js';
import { CHANNELS } from '../raster.js';
import type { ExportRequest, ExportResponse } from './protocol.js';

/** How a served worker sends a reply. `transfer` is the zero-copy hand-back. */
export type PostResponse = (response: ExportResponse, transfer: ArrayBuffer[]) => void;

/**
 * A worker's message handler.
 *
 * Holds one {@link BandRenderer} from the `begin` message onward, which is where
 * the basin field and the candidate scratch are hoisted to — see `render.ts`.
 */
export class ExportServer {
  private renderer: BandRenderer | undefined;
  private rowBytes = 0;

  constructor(private readonly post: PostResponse) {}

  handle(request: ExportRequest): void {
    if (request.type === 'begin') {
      this.renderer = new BandRenderer(request.job);
      this.rowBytes = request.job.size.width * CHANNELS;
      return;
    }

    const { requestId, row0, rows } = request;
    try {
      if (this.renderer === undefined) {
        throw new Error(
          'a band was requested before the job arrived; the pool must post `begin` first',
        );
      }
      const pixels = new Uint8Array(rows * this.rowBytes);
      this.renderer.render(row0, rows, pixels);
      this.post({ type: 'band', requestId, row0, rows, pixels }, [pixels.buffer]);
    } catch (error) {
      // Reported, never swallowed. A band that fails silently leaves a stripe of
      // black in a map that otherwise looks finished, which is the one failure
      // mode an exporter must not have.
      this.post(
        {
          type: 'failed',
          requestId,
          message: error instanceof Error ? error.message : String(error),
        },
        [],
      );
    }
  }
}
