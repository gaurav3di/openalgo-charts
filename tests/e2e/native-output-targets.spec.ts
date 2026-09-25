import { test, expect, type Page } from '@playwright/test';
import type { Chart, IndicatorApi } from '../../src/index';
import type * as Charts from '../../src/index';

declare global {
  interface Window {
    __outputTargets: { chart: Chart; study: IndicatorApi; clicks: string[] };
  }
}

async function painted(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Exact-colour ink per pane: the routed box, the routed marker and the plot-bound label. */
async function inkByPane(page: Page) {
  return page.evaluate(() => window.__outputTargets.chart.panes().map(pane => {
    const counts = { box: 0, dot: 0, label: 0 };
    for (const canvas of pane.element.querySelectorAll('canvas')) {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) continue;
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (r === 204 && g === 34 && b === 68) counts.box++;
        if (r === 238 && g === 204 && b === 34) counts.dot++;
        if (r === 153 && g === 51 && b === 204) counts.label++;
      }
    }
    return counts;
  }));
}

test('routed study drawings and markers paint where they are sent and follow the study', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 960, height: 700 });
  await page.route('**/output-targets.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#101010}#chart{height:100%}</style></head><body><div id="chart"></div></body></html>',
  }));
  await page.goto('/output-targets.html');
  await page.evaluate(async () => {
    const bundle = '/dist/openalgo-charts.mjs';
    const lib = await import(bundle) as typeof Charts;
    const chart = lib.createChart(document.querySelector<HTMLElement>('#chart')!, { branding: false, theme: lib.darkTheme });
    const source = chart.addSeries('candlestick');
    source.setData(Array.from({ length: 60 }, (_, i) => ({ time: 1700000000 + i * 60, open: 99, high: 102, low: 98, close: 100 + Math.sin(i) })));
    lib.registerIndicator({
      id: 'native-output-targets', name: 'Routed outputs', placement: 'pane',
      inputs: [{ key: 'onPrice', label: 'On price', type: 'boolean', default: true }],
      plots: [
        { key: 'osc', type: 'line', title: 'Osc', style: { color: '#ffffff' } },
        { key: 'alt', type: 'line', title: 'Alt', style: { color: '#888888' } },
      ],
      calc: bars => ({ osc: bars.map((_, i) => 30 + (i % 10)), alt: bars.map((_, i) => 500 + i) }),
      // Priced in the units of wherever the box is sent: the candles, or the oscillator.
      draws: ({ bars, settings }) => [
        { kind: 'box', from: { time: bars[20].time, price: settings.onPrice ? 104 : 37 }, to: { time: bars[35].time, price: settings.onPrice ? 96 : 32 },
          color: '#cc2244', fillColor: '#cc2244', opacity: 1, id: 'zone', ...(settings.onPrice ? { overlay: true } : {}) },
        { kind: 'label', at: { time: bars[45].time, price: 530 }, text: 'ALT', color: '#9933cc', textColor: '#9933cc', plot: 'alt' },
      ],
      markers: ({ bars }) => [{ time: bars[10].time, position: 'belowBar', shape: 'circle', size: 'big', color: '#eecc22', id: 'dot', overlay: true }],
    });
    const study = chart.addIndicator('native-output-targets', {}, { plotPriceScaleIds: { alt: 'left' } });
    chart.setVisibleLogicalRange({ from: -2, to: 62 });
    const clicks: string[] = [];
    chart.subscribeClick(id => { clicks.push(id); });
    window.__outputTargets = { chart, study, clicks };
  });
  await painted(page);
  const first = await inkByPane(page);
  expect(first).toHaveLength(2);
  expect(first[0].box).toBeGreaterThan(1000);
  expect(first[0].dot).toBeGreaterThan(20);
  expect(first[1]).toMatchObject({ box: 0, dot: 0 });
  expect(first[1].label).toBeGreaterThan(20);
  await page.screenshot({ path: info.outputPath('output-targets.png') });

  // The box reports its id where it is drawn, on the price pane.
  const point = await page.evaluate(() => {
    const { chart } = window.__outputTargets;
    const box = document.querySelector('#chart')!.getBoundingClientRect();
    return { x: box.left + chart.timeToCoordinate(1700000000 + 27 * 60), y: box.top + chart.priceToCoordinate(100, 0)! };
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.__outputTargets.clicks)).toEqual(['zone']);

  await page.evaluate(() => window.__outputTargets.study.setVisible(false));
  await painted(page);
  expect(await inkByPane(page)).toEqual([{ box: 0, dot: 0, label: 0 }, { box: 0, dot: 0, label: 0 }]);
  await page.evaluate(() => window.__outputTargets.study.setVisible(true));
  await painted(page);
  expect((await inkByPane(page))[0].box).toBeGreaterThan(1000);

  // A second instance owns a price-pane box of its own. Moving the first to a new
  // pane leaves its routed layers on the candles and takes its plot label along.
  await page.evaluate(() => {
    const { chart, study } = window.__outputTargets;
    chart.addIndicator('native-output-targets', {}, { plotPriceScaleIds: { alt: 'left' } });
    chart.moveIndicator(study.id, chart.panes().length);
  });
  await painted(page);
  const moved = await page.evaluate(() => window.__outputTargets.study.paneIndex);
  const afterMove = await inkByPane(page);
  expect(afterMove).toHaveLength(3);
  expect(afterMove[0].box).toBeGreaterThan(1000);
  expect(afterMove[moved].label).toBeGreaterThan(20);
  expect(afterMove[moved].box).toBe(0);

  // Switching the input sends the box back to the study's own pane.
  await page.evaluate(() => window.__outputTargets.study.setSettings({ onPrice: false }));
  await painted(page);
  const local = await inkByPane(page);
  expect(local[moved].box).toBeGreaterThan(20);
  expect(local[0].box).toBeGreaterThan(1000);

  // Removing the first leaves the second instance's box on the candles.
  await page.evaluate(() => window.__outputTargets.study.remove());
  await painted(page);
  const remaining = await inkByPane(page);
  expect(remaining[0].box).toBeGreaterThan(1000);
  expect(remaining.slice(1).every(counts => counts.box === 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('output-targets-after-removal.png') });
  expect(errors).toEqual([]);
});

test('a routed box follows candles on the left axis and leaves the axis free to move', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 960, height: 700 });
  await page.route('**/output-targets.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#101010}#chart{height:100%}</style></head><body><div id="chart"></div></body></html>',
  }));
  await page.goto('/output-targets.html');
  await page.evaluate(async () => {
    const bundle = '/dist/openalgo-charts.mjs';
    const lib = await import(bundle) as typeof Charts;
    const chart = lib.createChart(document.querySelector<HTMLElement>('#chart')!, { branding: false, theme: lib.darkTheme });
    // The instrument on the left axis from the start, nothing on the right.
    chart.addSeries('candlestick', { priceScaleId: 'left' })
      .setData(Array.from({ length: 60 }, (_, i) => ({ time: 1700000000 + i * 60, open: 99, high: 102, low: 98, close: 100 + Math.sin(i) })));
    lib.registerIndicator({
      id: 'native-output-targets-left', name: 'Routed box', placement: 'pane', inputs: [],
      plots: [{ key: 'osc', type: 'line', title: 'Osc', style: { color: '#ffffff' } }],
      calc: bars => ({ osc: bars.map((_, i) => 30 + (i % 10)) }),
      draws: ({ bars }) => [{ kind: 'box', from: { time: bars[20].time, price: 104 }, to: { time: bars[35].time, price: 96 },
        color: '#cc2244', fillColor: '#cc2244', opacity: 1, id: 'zone', overlay: true }],
    });
    const study = chart.addIndicator('native-output-targets-left');
    chart.setVisibleLogicalRange({ from: -2, to: 62 });
    const clicks: string[] = [];
    chart.subscribeClick(id => { clicks.push(id); });
    window.__outputTargets = { chart, study, clicks };
  });
  await painted(page);
  const onLeft = await inkByPane(page);
  expect(onLeft[0].box).toBeGreaterThan(1000);
  expect(await page.evaluate(() => window.__outputTargets.chart.panes()[0].usesScale('right'))).toBe(false);
  await page.screenshot({ path: info.outputPath('output-targets-left-axis.png') });
  const clickBox = async () => {
    const point = await page.evaluate(() => {
      const { chart } = window.__outputTargets;
      const box = document.querySelector('#chart')!.getBoundingClientRect();
      return { x: box.left + chart.timeToCoordinate(1700000000 + 27 * 60), y: box.top + chart.priceToCoordinate(100, 0)! };
    });
    await page.mouse.click(point.x, point.y);
  };
  await clickBox();
  await expect.poll(() => page.evaluate(() => window.__outputTargets.clicks)).toEqual(['zone']);

  // The axis can move back and forth; the box goes with the candles each time.
  expect(await page.evaluate(() => window.__outputTargets.chart.movePriceAxis(0, 'left', 'right'))).toBe(true);
  await painted(page);
  expect((await inkByPane(page))[0].box).toBeGreaterThan(1000);
  await clickBox();
  await expect.poll(() => page.evaluate(() => window.__outputTargets.clicks)).toEqual(['zone', 'zone']);
  expect(await page.evaluate(() => window.__outputTargets.chart.movePriceAxis(0, 'right', 'left'))).toBe(true);
  await painted(page);
  expect((await inkByPane(page))[0].box).toBeGreaterThan(1000);
  await page.screenshot({ path: info.outputPath('output-targets-axis-moved-back.png') });
  expect(errors).toEqual([]);
});
