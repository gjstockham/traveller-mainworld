/**
 * The battery and the fixtures, in a browser worker.
 *
 * Deliberately thin: it runs the same `runBattery` and `runFixtures` over the
 * same sizes as the Node runner and reports raw hashes. Comparison against
 * either manifest happens on the page, so nothing in here can decide it passed.
 */
import { GEN_VERSION } from '@traveller-mainworld/core';

import { BATTERY, FULL_BATTERY, QUICK_BATTERY, batteryDigest, runBattery } from '../src/battery.js';
import { FULL_FIXTURES, QUICK_FIXTURES, runFixtures } from '../src/fixtures.js';
import { tsKernelApi } from '../src/kernelApi.js';

import type { StartRequest, WorkerMessage } from './protocol.js';

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<StartRequest>) => {
  const request = event.data;
  const quick = request.size === 'quick';
  const started = performance.now();

  try {
    if (request.type === 'battery') {
      let index = 0;
      const results = runBattery(tsKernelApi(), quick ? QUICK_BATTERY : FULL_BATTERY, (result) => {
        post({ type: 'case', index: index++, total: BATTERY.length, result });
      });
      post({
        type: 'battery-done',
        results,
        digest: batteryDigest(results),
        elapsedMs: performance.now() - started,
      });
      return;
    }

    const results = runFixtures(tsKernelApi().generator(GEN_VERSION), {
      size: quick ? QUICK_FIXTURES : FULL_FIXTURES,
      ids: request.ids,
      onProgress: (result) => {
        post({ type: 'fixture', result });
      },
    });
    post({ type: 'fixtures-done', results, elapsedMs: performance.now() - started });
  } catch (error) {
    post({
      type: 'failure',
      task: request.type === 'battery' ? 'battery' : 'fixtures',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
