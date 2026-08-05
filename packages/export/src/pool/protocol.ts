/**
 * The messages an export worker exchanges.
 *
 * The same shape as `viewer/src/stream/protocol.ts` and for the same reason: the
 * protocol is a plain-data module both sides import, so a change to it is a type
 * error on both sides rather than a runtime surprise on one.
 *
 * Everything here is structured-cloneable. `ExportJob` is plain data by
 * construction (see `job.ts`) — the projection travels as an id and its options,
 * not as an object — which is what lets a whole job be posted once at worker
 * start and only band coordinates be posted per request.
 */
import type { ExportJob } from '../job.js';

/** Main thread → worker: this is the map we are rendering. Sent once. */
export interface BeginMessage {
  readonly type: 'begin';
  readonly job: ExportJob;
}

/** Main thread → worker: render these rows. */
export interface BandMessage {
  readonly type: 'band';
  readonly requestId: number;
  readonly row0: number;
  readonly rows: number;
}

/** Worker → main thread: here they are. `pixels` is transferred, not copied. */
export interface BandDoneMessage {
  readonly type: 'band';
  readonly requestId: number;
  readonly row0: number;
  readonly rows: number;
  readonly pixels: Uint8Array;
}

/**
 * Worker → main thread: this band threw.
 *
 * Carried as a message rather than left to an `onerror` handler, because a band
 * that fails silently leaves a stripe of black in a map that otherwise looks
 * finished — the one failure mode an exporter must not have.
 */
export interface BandFailedMessage {
  readonly type: 'failed';
  readonly requestId: number;
  readonly message: string;
}

export type ExportRequest = BeginMessage | BandMessage;
export type ExportResponse = BandDoneMessage | BandFailedMessage;
