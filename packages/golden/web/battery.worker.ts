/**
 * The battery, in a browser worker.
 *
 * Deliberately thin: it runs the same `runBattery` over the same `FULL_BATTERY`
 * size as the Node runner and reports raw hashes. Comparison against the
 * manifest happens on the page, so nothing in here can decide it passed.
 */
import { BATTERY, FULL_BATTERY, QUICK_BATTERY, batteryDigest, runBattery } from '../src/battery.js';
import { tsKernelApi } from '../src/kernelApi.js';

import type { StartRequest, WorkerMessage } from './protocol.js';

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<StartRequest>) => {
  const size = event.data.size === 'quick' ? QUICK_BATTERY : FULL_BATTERY;
  const started = performance.now();
  try {
    let index = 0;
    const results = runBattery(tsKernelApi(), size, (result) => {
      post({ type: 'case', index: index++, total: BATTERY.length, result });
    });
    post({
      type: 'done',
      results,
      digest: batteryDigest(results),
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    post({ type: 'failure', message: error instanceof Error ? error.message : String(error) });
  }
});
