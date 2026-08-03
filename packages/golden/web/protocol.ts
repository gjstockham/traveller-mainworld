/**
 * Messages between the verification page and its battery worker.
 *
 * The battery is ~15 s of straight-line synchronous work on Node and slower in
 * a browser. Run on the main thread it would freeze the page long enough for a
 * browser to offer to kill it — and a spot-check that has to be rescued from an
 * "unresponsive page" dialog is not a spot-check anyone will repeat. It also
 * runs in a worker in the real generator, so this is the honest arrangement.
 */
import type { BatteryResult } from '../src/battery.js';

/** Which battery size to run. `quick` is for developing the page itself. */
export type BatterySizeName = 'full' | 'quick';

export interface StartRequest {
  readonly type: 'start';
  readonly size: BatterySizeName;
}

export interface CaseMessage {
  readonly type: 'case';
  readonly index: number;
  readonly total: number;
  readonly result: BatteryResult;
}

export interface DoneMessage {
  readonly type: 'done';
  readonly results: readonly BatteryResult[];
  readonly digest: string;
  readonly elapsedMs: number;
}

/**
 * A thrown error, flattened.
 *
 * `runCase` throws on NaN rather than hashing an unportable bit pattern, so a
 * throw here is a finding — it has to reach the page, not just the console of a
 * phone nobody can open devtools on.
 */
export interface FailureMessage {
  readonly type: 'failure';
  readonly message: string;
}

export type WorkerMessage = CaseMessage | DoneMessage | FailureMessage;
