/**
 * Messages between the verification page and its workers.
 *
 * Two tasks run in-page, against two separate manifests: the determinism
 * battery (kernel functions over hostile inputs) and the golden fixtures (whole
 * worlds through the shipping `TileGenerator`). Neither runs on the main
 * thread — together they are minutes of straight-line synchronous work, and a
 * spot-check that has to be rescued from an "unresponsive page" dialog is not a
 * spot-check anyone will repeat. They run in workers in the real generator too,
 * so this is also the honest arrangement.
 *
 * The battery is one sequential worker because its cases are cheap relative to
 * the fixtures. The fixtures are sharded across a pool, because each fixture is
 * an independent pure function of its own spec and seed — which worker
 * evaluates one cannot reach its hash. That is a property of the runner, and it
 * is the reason the fixture *set* never has to answer to a stopwatch.
 */
import type { BatteryResult } from '../src/battery.js';
import type { FixtureResult } from '../src/fixtures.js';

/** Which run size. `quick` is for developing the page itself. */
export type RunSizeName = 'full' | 'quick';

/** Run the determinism battery, whole, in this worker. */
export interface BatteryRequest {
  readonly type: 'battery';
  readonly size: RunSizeName;
}

/** Run this worker's shard of the fixture set. */
export interface FixturesRequest {
  readonly type: 'fixtures';
  readonly size: RunSizeName;
  /** Fixture ids assigned to this worker. */
  readonly ids: readonly string[];
}

export type StartRequest = BatteryRequest | FixturesRequest;

export interface CaseMessage {
  readonly type: 'case';
  readonly index: number;
  readonly total: number;
  readonly result: BatteryResult;
}

export interface BatteryDoneMessage {
  readonly type: 'battery-done';
  readonly results: readonly BatteryResult[];
  readonly digest: string;
  readonly elapsedMs: number;
}

export interface FixtureMessage {
  readonly type: 'fixture';
  readonly result: FixtureResult;
}

/**
 * One worker's shard, complete.
 *
 * Results carry their fixture id, and the page re-sorts them into `FIXTURES`
 * order before hashing the digest — so shard boundaries and completion order
 * cannot reach the committed value.
 */
export interface FixturesDoneMessage {
  readonly type: 'fixtures-done';
  readonly results: readonly FixtureResult[];
  readonly elapsedMs: number;
}

/**
 * A thrown error, flattened.
 *
 * `runCase` throws on NaN rather than hashing an unportable bit pattern, and
 * `assertClean` throws on a non-finite elevation, so a throw here is a finding.
 * It has to reach the page, not just the console of a phone nobody can open
 * devtools on.
 */
export interface FailureMessage {
  readonly type: 'failure';
  readonly task: 'battery' | 'fixtures';
  readonly message: string;
}

export type WorkerMessage =
  | CaseMessage
  | BatteryDoneMessage
  | FixtureMessage
  | FixturesDoneMessage
  | FailureMessage;
