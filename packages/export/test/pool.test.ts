import { interpretText } from '@traveller-mainworld/core';
import { describe, expect, it } from 'vitest';

import { buildExportJob } from '../src/exportMap.js';
import type { ExportJob } from '../src/job.js';
import { LocalBandWorker } from '../src/pool/local.js';
import { type BandWorker, ExportAborted, renderWithPool } from '../src/pool/pool.js';
import type { ExportResponse } from '../src/pool/protocol.js';
import { ExportServer } from '../src/pool/serve.js';
import { CHANNELS } from '../src/raster.js';
import { renderMapSync } from '../src/render.js';
import type { ImageSize } from '../src/size.js';

const SIZE: ImageSize = { width: 64, height: 48 };

function jobFor(size: ImageSize = SIZE): ExportJob {
  return buildExportJob(
    { spec: interpretText('X400000-0'), seedHi: 0x0badf00d, seedLo: 0xcafebabe },
    {
      upp: 'X400000-0',
      fixtureId: undefined,
      seedText: '42',
      rulesetId: 'cepheus-1',
      rulesetName: 'Cepheus Engine',
      fidelity: undefined,
    },
    { size, projectionId: 'equirectangular', graticule: false, titleBlock: false },
  );
}

function pool(job: ExportJob, count: number): BandWorker[] {
  return Array.from({ length: count }, () => new LocalBandWorker(job));
}

// Sixteen pooled renders of the same map, so this block is generation-bound like
// the fixture and crater suites and takes their budget rather than vitest's
// five-second default. It ran in 3839 ms on the Windows CI runner — 77% of a
// default nobody chose — which is the state `fixtures.test.ts` was in when WP13's
// push turned that leg red.
describe('bands are independent, so the pool is free', { timeout: 120_000 }, () => {
  it('gives the same image at every pool size and every band height', async () => {
    // The property that makes the parallelism free rather than a source of
    // nondeterminism. A band's pixels are a pure function of the band, so bands
    // may be rendered in any order on any number of workers and pasted in as
    // they land — asserted against the single-threaded render, byte for byte.
    const job = jobFor();
    const reference = Array.from(renderMapSync(job).data);

    for (const workers of [1, 2, 3, 5]) {
      for (const bandRows of [1, 5, 16, SIZE.height]) {
        const raster = await renderWithPool(job, pool(job, workers), { bandRows });
        expect(Array.from(raster.data)).toEqual(reference);
      }
    }
  });

  it('takes bands as a queue, so a slow worker does not hold up the map', async () => {
    // Bands are not equal in cost — a polar band's basin cull keeps almost
    // nothing where an equatorial one keeps a dozen basins — so a static split
    // would leave one worker running long after the rest had finished. This
    // asserts the queue by making one worker very slow and checking the others
    // took more than their static share.
    const job = jobFor();
    const taken = [0, 0];
    const workers: BandWorker[] = [0, 1].map((index) => {
      const inner = new LocalBandWorker(job);
      return {
        async render(row0, rows) {
          taken[index] = taken[index]! + 1;
          if (index === 0) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return inner.render(row0, rows);
        },
        dispose() {
          inner.dispose();
        },
      };
    });

    await renderWithPool(job, workers, { bandRows: 4 });
    expect(taken[0]! + taken[1]!).toBe(SIZE.height / 4);
    expect(taken[1]!).toBeGreaterThan(taken[0]!);
  });

  it('reports progress once per band, monotonically, ending at the full height', async () => {
    const job = jobFor();
    const seen: number[] = [];
    await renderWithPool(job, pool(job, 3), {
      bandRows: 6,
      onProgress: ({ rows, total }) => {
        expect(total).toBe(SIZE.height);
        seen.push(rows);
      },
    });
    expect(seen).toHaveLength(SIZE.height / 6);
    expect(seen[seen.length - 1]!).toBe(SIZE.height);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    }
  });

  it('handles a final band shorter than the rest', async () => {
    const size = { width: 16, height: 10 };
    const job = jobFor(size);
    const raster = await renderWithPool(job, pool(job, 2), { bandRows: 4 });
    expect(Array.from(raster.data)).toEqual(Array.from(renderMapSync(job, 4).data));
  });

  it('disposes every worker, including when a band throws', async () => {
    const job = jobFor();
    let disposed = 0;
    const workers: BandWorker[] = [0, 1].map((index) => ({
      render(row0, rows) {
        if (index === 1) {
          return Promise.reject(new Error('band exploded'));
        }
        return new LocalBandWorker(job).render(row0, rows);
      },
      dispose() {
        disposed++;
      },
    }));
    await expect(renderWithPool(job, workers, { bandRows: 8 })).rejects.toThrow(/exploded/);
    expect(disposed).toBe(2);
  });

  it('refuses a worker that returns the wrong number of bytes', async () => {
    // A band that came back short would leave a stripe of black in a map that
    // otherwise looked finished — the one failure mode an exporter must not
    // have, so it is a throw rather than a `set` that silently copies less.
    const job = jobFor();
    const workers: BandWorker[] = [
      { render: () => Promise.resolve(new Uint8Array(4)), dispose: () => undefined },
    ];
    await expect(renderWithPool(job, workers, { bandRows: 8 })).rejects.toThrow(
      /returned 4 bytes/,
    );
  });

  it('refuses an empty pool', async () => {
    await expect(renderWithPool(jobFor(), [])).rejects.toThrow(/at least one worker/);
  });

  it('aborts between bands rather than rendering a map somebody cancelled', async () => {
    const job = jobFor();
    const signal = { aborted: false };
    const workers = pool(job, 1).map((inner) => ({
      async render(row0: number, rows: number) {
        const pixels = await inner.render(row0, rows);
        if (row0 >= 8) {
          signal.aborted = true;
        }
        return pixels;
      },
      dispose: () => {
        inner.dispose();
      },
    }));
    await expect(renderWithPool(job, workers, { bandRows: 8, signal })).rejects.toThrow(
      ExportAborted,
    );
  });
});

describe('the worker side of the protocol', () => {
  // `viewer/src/workers/exportWorker.ts` is four lines around `ExportServer`, so
  // the state machine is tested here rather than only in a browser — which is
  // the whole reason the split exists (browser measurements do not happen under
  // WSL2).
  function serve(): { server: ExportServer; sent: ExportResponse[] } {
    const sent: ExportResponse[] = [];
    const server = new ExportServer((response) => {
      sent.push(response);
    });
    return { server, sent };
  }

  it('renders the same bytes a local worker would', async () => {
    const job = jobFor();
    const { server, sent } = serve();
    server.handle({ type: 'begin', job });
    server.handle({ type: 'band', requestId: 7, row0: 8, rows: 4 });

    expect(sent).toHaveLength(1);
    const reply = sent[0]!;
    expect(reply.type).toBe('band');
    if (reply.type !== 'band') {
      throw new Error('unreachable');
    }
    expect(reply.requestId).toBe(7);
    expect(reply.pixels.length).toBe(4 * SIZE.width * CHANNELS);

    const expected = await new LocalBandWorker(job).render(8, 4);
    expect(Array.from(reply.pixels)).toEqual(Array.from(expected));
  });

  it('reports a band before `begin` as a failure rather than throwing into the void', () => {
    // A worker whose error handler does nothing leaves the pool waiting forever
    // and the user watching a progress bar that has stopped. A named failure is
    // the only useful outcome.
    const { server, sent } = serve();
    server.handle({ type: 'band', requestId: 1, row0: 0, rows: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('failed');
    if (sent[0]!.type !== 'failed') {
      throw new Error('unreachable');
    }
    expect(sent[0]!.message).toMatch(/before the job arrived/);
    expect(sent[0]!.requestId).toBe(1);
  });

  it('reports a bad band request as a failure, keeping its request id', () => {
    const { server, sent } = serve();
    server.handle({ type: 'begin', job: jobFor() });
    server.handle({ type: 'band', requestId: 3, row0: SIZE.height, rows: 4 });
    expect(sent[0]!.type).toBe('failed');
    if (sent[0]!.type !== 'failed') {
      throw new Error('unreachable');
    }
    expect(sent[0]!.requestId).toBe(3);
    expect(sent[0]!.message).toMatch(/outside/);
  });

  it('hands the pixel buffer back for transfer rather than copying it', () => {
    const sent: [ExportResponse, ArrayBuffer[]][] = [];
    const server = new ExportServer((response, transfer) => {
      sent.push([response, transfer]);
    });
    server.handle({ type: 'begin', job: jobFor() });
    server.handle({ type: 'band', requestId: 1, row0: 0, rows: 2 });
    const [response, transfer] = sent[0]!;
    if (response.type !== 'band') {
      throw new Error('unreachable');
    }
    expect(transfer).toHaveLength(1);
    expect(transfer[0]).toBe(response.pixels.buffer);
  });

  it('carries a whole job through a structured clone, projection and all', () => {
    // `ExportJob` is plain data by construction — the projection travels as an
    // id plus its options, not as an object — which is what lets it be posted to
    // a worker at all. A class instance here would fail only in a browser.
    const job = buildExportJob(
      { spec: interpretText('X400000-0'), seedHi: 1, seedLo: 2 },
      {
        upp: 'X400000-0', fixtureId: undefined, seedText: '1',
        rulesetId: 'cepheus-1', rulesetName: 'Cepheus Engine', fidelity: undefined,
      },
      { size: SIZE, projectionId: 'mercator', projectionOptions: { clipDeg: 70 } },
    );
    const cloned = structuredClone(job) as ExportJob;
    expect(cloned).toEqual(job);

    const { server, sent } = serve();
    server.handle({ type: 'begin', job: cloned });
    server.handle({ type: 'band', requestId: 1, row0: 0, rows: 2 });
    expect(sent[0]!.type).toBe('band');
  });
});
