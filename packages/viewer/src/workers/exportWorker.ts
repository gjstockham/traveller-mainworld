/**
 * Map export worker.
 *
 * Deliberately thin, for the same reason `tileWorker.ts` is: everything the
 * state machine does — one renderer for the life of the worker, a `begin` before
 * any `band`, a failure reported rather than thrown into the void — lives in
 * `ExportServer` in `packages/export`, where it is testable in Node. This file
 * is the four lines that wire it to `self`.
 *
 * That split matters more here than it did for tiles. Browser measurements do
 * not happen under WSL2 (the repo's standing note), so anything that only exists
 * inside a `Worker` is something nobody on this machine can check. About two
 * thousand lines of the exporter are testable in Node, and this is not one of
 * them precisely because there is nothing in it.
 */
import { ExportServer, type ExportRequest } from '@traveller-mainworld/export';

const server = new ExportServer((response, transfer) => {
  self.postMessage(response, { transfer });
});

self.onmessage = (event: MessageEvent<ExportRequest>): void => {
  server.handle(event.data);
};
