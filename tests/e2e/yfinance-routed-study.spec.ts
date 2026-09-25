import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Chart } from '../../src/index';

type DemoWindow = Window & { __oac: { app: { chart: Chart; loading: boolean } } };

const SAMPLE_ID = 'routed-signal-sample';
// Wide swings, so the momentum histogram crosses zero several times and the
// sample has Buy and Sell plates to route.
const BARS = Array.from({ length: 80 }, (_, index) => {
  const close = 100 + 20 * Math.sin(index / 4);
  return { time: 1_789_776_000 + index * 86400, open: close - 1, high: close + 3, low: close - 3, close, volume: 2000 };
});
const TOP = Math.max(...BARS.slice(BARS.length - 31).map(bar => bar.high));

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page, request }) => {
  const up = await request.get('/api/history?symbol=AAPL&interval=1d&period=1mo').then(response => response.ok(), () => false);
  test.skip(!up, 'the yfinance fixture server is not available');
  await page.route('**/api/history?**', route => route.fulfill({ json: BARS }));
  await page.goto('/examples/yfinance/index.html?test=1');
  await page.waitForFunction(() => Boolean((window as unknown as DemoWindow).__oac?.app.chart)
    && !(window as unknown as DemoWindow).__oac.app.loading);
  await expect(page.locator(`#indpick option[value="${SAMPLE_ID}"]`)).toHaveCount(1);
});

async function paint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await shot(page, info, 'failure');
});

/**
 * What each pane holds of the sample: its Buy and Sell plates where they were
 * last drawn, where the range box was drawn, whether the Now label is there,
 * and how many pixels carry the box's exact label colour.
 */
async function routed(page: Page) {
  return page.evaluate(() => {
    const { chart } = (window as unknown as DemoWindow).__oac.app;
    type Layer = { _lastPositions?: { id: string; y: number }[]; _items?: { id?: string; text?: string }[]; _hits?: { id: string; y: number }[] };
    return chart.panes().map(pane => {
      const layers = pane.primitives() as unknown as Layer[];
      let ink = 0;
      for (const canvas of pane.element.querySelectorAll('canvas')) {
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] === 255 && pixels[i] === 79 && pixels[i + 1] === 140 && pixels[i + 2] === 255) ink++;
        }
      }
      return {
        plates: layers.flatMap(layer => layer._lastPositions ?? []).filter(mark => mark.id.startsWith('signal:')).length,
        rangeTop: layers.flatMap(layer => layer._hits ?? []).find(hit => hit.id === 'routed-range')?.y ?? null,
        now: layers.some(layer => layer._items?.some(item => item.text === 'Now') === true),
        ink,
      };
    });
  });
}

test('the routed signal sample draws on the candles and follows them to the other axis', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const before = await routed(page);
  await page.locator('#chart').focus();
  await page.getByRole('button', { name: 'Add an indicator', exact: true }).click();
  await expect(page.locator('.oac-pick')).toHaveCount(1);
  await page.locator(`.oac-pick__row[data-id="${SAMPLE_ID}"]`).click();
  await paint(page);
  const study = await page.evaluate(id => {
    const { chart } = (window as unknown as DemoWindow).__oac.app;
    const found = chart.indicators().filter(item => item.indicatorId === id);
    return { id: found[found.length - 1].id, pane: found[found.length - 1].paneIndex };
  }, SAMPLE_ID);
  expect(study.pane).toBeGreaterThan(0);
  const first = await routed(page);
  await shot(page, info, 'routed-on-candles');
  // Plates and the box on the candles; the Now label with the histogram.
  expect(first[0].plates).toBeGreaterThan(1);
  expect(first[study.pane].plates).toBe(0);
  expect(first[study.pane].now).toBe(true);
  expect(first[0].ink - before[0].ink).toBeGreaterThan(50);
  // The box top is the highest high of the last 31 bars, measured where the candles are.
  const top = () => page.evaluate(price => (window as unknown as DemoWindow).__oac.app.chart.panes()[0].readoutScale().priceToY(price), TOP);
  expect(first[0].rangeTop).not.toBeNull();
  expect(Math.abs(first[0].rangeTop! - await top())).toBeLessThan(2);

  // Moving the candles' axis to the left is allowed, and the box goes with them.
  expect(await page.evaluate(() => (window as unknown as DemoWindow).__oac.app.chart.movePriceAxis(0, 'right', 'left'))).toBe(true);
  await paint(page);
  const moved = await routed(page);
  await shot(page, info, 'routed-axis-left');
  expect(moved[0].plates).toBeGreaterThan(1);
  expect(Math.abs(moved[0].rangeTop! - await top())).toBeLessThan(2);
  expect(await page.evaluate(() => (window as unknown as DemoWindow).__oac.app.chart.movePriceAxis(0, 'left', 'right'))).toBe(true);

  // Signals on price off sends the plates to the histogram pane; the box stays.
  await page.evaluate(id => {
    (window as unknown as DemoWindow).__oac.app.chart.indicators().find(item => item.id === id)!.setSettings({ onPrice: false });
  }, study.id);
  await paint(page);
  const local = await routed(page);
  expect(local[0].plates).toBe(0);
  expect(local[study.pane].plates).toBeGreaterThan(1);
  expect(local[0].rangeTop).not.toBeNull();

  // Removing the study takes every routed layer with it.
  await page.evaluate(id => { (window as unknown as DemoWindow).__oac.app.chart.removeIndicator(id); }, study.id);
  await paint(page);
  const removed = await routed(page);
  expect(removed[0]).toMatchObject({ plates: 0, rangeTop: null, now: false });
  expect(removed[0].ink).toBeLessThanOrEqual(before[0].ink + 10);
  expect(errors).toEqual([]);
});
