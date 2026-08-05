import { expect, test } from '@playwright/test';

/**
 * Spike C smoke test: does the walking skeleton actually walk?
 *
 * Boots the real app in a real browser and checks the whole pipeline runs —
 * workers spawn, tiles generate and stream in, meshes reach the scene, frames
 * render, and the camera responds. This cannot judge whether the planet *looks*
 * right (no cracks, plausible relief); that stays a human check against the
 * Spike C exit criteria. What it does do is stop the skeleton silently breaking.
 */

/**
 * The diagnostics panel.
 *
 * Located by `data-role` rather than by element type: WP12 put a second `pre`
 * and several more buttons on the page, and `#app pre` stopped naming one
 * thing. The attribute exists for this.
 */
const OVERLAY = '#app pre[data-role="diagnostics"]';

/** Read the diagnostics overlay, which is the app's own view of its health. */
async function readOverlay(page: import('@playwright/test').Page): Promise<string> {
  return (await page.locator(OVERLAY).innerText()).trim();
}

/**
 * Wait for the overlay to exist *and* to have been written to.
 *
 * The element is created empty and repainted at most every 250 ms, so it can be
 * visible with no text in it. `expect.poll` propagates an exception from its
 * callback rather than retrying, so a `metric()` call landing in that window
 * failed the run outright — a flake with nothing to do with what was under
 * test. Waiting for the first line to appear removes the window.
 */
async function awaitOverlay(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator(OVERLAY)).toContainText('fps', { timeout: 20_000 });
}

function metric(overlay: string, label: string): number {
  const line = overlay.split('\n').find((l) => l.startsWith(label));
  if (line === undefined) {
    throw new Error(`no '${label}' line in overlay:\n${overlay}`);
  }
  const match = /-?\d+(\.\d+)?/.exec(line.slice(label.length));
  if (match === null) {
    throw new Error(`no number in overlay line: ${line}`);
  }
  return Number(match[0]);
}

test('boots, streams tiles and renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push(m.text());
    }
  });

  await page.goto('/');

  // The overlay only appears once the first frame has run.
  await awaitOverlay(page);

  // Tiles must actually arrive — a globe with zero tiles is a black screen.
  await expect
    .poll(async () => metric(await readOverlay(page), 'tiles'), { timeout: 30_000 })
    .toBeGreaterThan(5);

  const overlay = await readOverlay(page);
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);

  // Every part of the pipeline reported something sane.
  expect(metric(overlay, 'tris'), 'triangles').toBeGreaterThan(0);
  expect(metric(overlay, 'cache'), 'cached tiles').toBeGreaterThan(0);
  expect(metric(overlay, 'xfer'), 'bytes transferred').toBeGreaterThan(0);

  // Canvas is actually sized and present.
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);

  // The memory block is what the Spike C 10-minute criterion is read off, so
  // "it renders in a real browser" is worth asserting rather than assuming.
  // Resident bytes are counted by us and must be non-zero once tiles exist.
  expect(metric(overlay, 'resident'), 'resident tile bytes').toBeGreaterThan(0);
  // Chromium exposes performance.memory, so this leg must show a real reading
  // and not the unavailable sentence — which is how the sentence itself stays
  // honest rather than becoming what every browser prints.
  expect(overlay, 'heap readout').toMatch(/^heap +\d/m);
  expect(overlay).toContain('main thread only');
});

test('hands back a pasteable evidence block', async ({ page, context }) => {
  // The Spike C criteria are recorded by pressing this button and pasting into
  // docs/evidence/spikec-exit.md, so "the button works" is part of the
  // measurement path rather than a UI nicety.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?fixture=size8-earthlike');
  await awaitOverlay(page);
  await expect
    .poll(async () => metric(await readOverlay(page), 'tiles'), { timeout: 30_000 })
    .toBeGreaterThan(5);

  // Located by role attribute, not by name: the label is what the click
  // changes, so a name-based locator stops matching the element it just
  // pressed — and `#app button` stopped being unique when WP12 landed.
  const button = page.locator('#app button[data-role="copy-evidence"]');
  await expect(button).toHaveText('Copy evidence');
  await button.click();
  await expect(button).toHaveText('Copied', { timeout: 5_000 });

  const copied = await page.evaluate(() => navigator.clipboard.readText());

  // The label must go back, or a second press produces no visible change and is
  // indistinguishable from a button that has stopped working — which is how a
  // ten-minute session ends with nothing recorded.
  //
  // Bounded at 10 s for a 1.5 s timer, deliberately: the render loop starves
  // setTimeout when the main thread is saturated, and under SwiftShader that
  // reset was measured arriving at 4.0 s. The generosity is about the harness,
  // not about the product — but it is also why the label reset exists at all
  // rather than relying on the user noticing a fast flicker.
  await expect(button).toHaveText('Copy evidence', { timeout: 10_000 });
  await button.click();
  await expect(button).toHaveText('Copied', { timeout: 5_000 });

  // The stamp: what produced the numbers.
  expect(copied).toContain('size8-earthlike');
  expect(copied).toContain('tile mesh');
  expect(copied).toContain('exaggeration');
  expect(copied).toContain('user agent');
  expect(copied).toContain('build');
  // And the numbers themselves, or the block is only half of one.
  expect(copied).toMatch(/^fps /m);
  expect(copied).toMatch(/^resident /m);
});

test('discloses hidden time rather than booking it as a stall', async ({ page }) => {
  await page.goto('/');
  await awaitOverlay(page);

  // An uninterrupted session says nothing about hidden time, and a reader is
  // entitled to take that silence at face value.
  expect(await readOverlay(page)).not.toContain('hidden');

  // Headless Chromium cannot really be backgrounded, so the visibility state is
  // overridden and the event dispatched by hand. This exercises the wiring —
  // listener attached, clock consulted, line rendered — and not the browser's
  // own hiding behaviour, which is the part that has to be taken on trust.
  await page.evaluate(async () => {
    const fake = (state: string): void => {
      Object.defineProperty(document, 'visibilityState', {
        value: state,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    fake('hidden');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    fake('visible');
  });

  await expect(page.locator(OVERLAY)).toContainText('hidden in 1 gap', { timeout: 10_000 });
  const overlay = await readOverlay(page);
  expect(overlay).toContain('total');
  expect(overlay).toContain('active');

  // And the frame that carried the gap is not a stall: the whole point.
  const worst = overlay.split('\n').find((l) => l.startsWith('worst')) ?? '';
  expect(worst).toContain('resumed frame(s) excluded');
  expect(worst).not.toContain('STALL');
});

test('refines LOD as the camera zooms in', async ({ page }) => {
  await page.goto('/');
  await awaitOverlay(page);
  await expect
    .poll(async () => metric(await readOverlay(page), 'tiles'), { timeout: 30_000 })
    .toBeGreaterThan(5);

  const depthOf = (overlay: string): number => {
    const line = overlay.split('\n').find((l) => l.startsWith('tiles'))!;
    return Number(/depth (\d+)/.exec(line)![1]);
  };

  const before = depthOf(await readOverlay(page));

  // Zoom in hard.
  const canvas = page.locator('#app canvas');
  await canvas.hover();
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
  }

  // Deeper tiles must appear, which exercises split, streaming and upload.
  await expect
    .poll(async () => depthOf(await readOverlay(page)), { timeout: 30_000 })
    .toBeGreaterThan(before);
});

test('keeps rendering while the camera orbits', async ({ page }) => {
  await page.goto('/');
  await awaitOverlay(page);
  await expect
    .poll(async () => metric(await readOverlay(page), 'tiles'), { timeout: 30_000 })
    .toBeGreaterThan(5);

  const generatedBefore = metric(await readOverlay(page), 'xfer');

  const canvas = page.locator('#app canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 4);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(3000);

  const overlay = await readOverlay(page);
  // Still drawing a globe after the camera moved, and the newly exposed side
  // streamed in rather than the pipeline seizing up.
  expect(metric(overlay, 'tiles')).toBeGreaterThan(5);
  expect(metric(overlay, 'xfer')).toBeGreaterThanOrEqual(generatedBefore);

  // Deliberately NOT asserting frame time. Headless Chromium rasterises in
  // software (SwiftShader), where a few hundred thousand triangles runs at a
  // handful of fps — a real number, but not one that says anything about the
  // integrated-GPU target the Spike C criteria are written against. Frame rate
  // is measured from the diagnostics overlay on real hardware.
});

test('renders a recognisable globe', async ({ page }) => {
  // ?debug preserves the WebGL drawing buffer; without it the buffer is
  // cleared once composited and reads back empty.
  await page.goto('/?debug=1');
  await awaitOverlay(page);
  await expect
    .poll(async () => metric(await readOverlay(page), 'tiles'), { timeout: 30_000 })
    .toBeGreaterThan(20);
  // Let the initial shell finish streaming before capturing.
  await page.waitForTimeout(8000);

  await page.locator('#app canvas').screenshot({ path: 'e2e/output/globe.png' });

  // A lit sphere on a dark background: a good fraction of pixels must be
  // background, and a good fraction clearly lit. All-black means nothing drew;
  // all-bright means the camera is inside the planet.
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('#app canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = 200;
    off.height = 200;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 200, 200);
    const { data } = ctx.getImageData(0, 0, 200, 200);
    let dark = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      if (luma < 20) dark++;
      else if (luma > 40) lit++;
    }
    return { dark, lit, total: data.length / 4 };
  });

  expect(stats.lit / stats.total, 'lit fraction').toBeGreaterThan(0.05);
  expect(stats.dark / stats.total, 'background fraction').toBeGreaterThan(0.05);
});
