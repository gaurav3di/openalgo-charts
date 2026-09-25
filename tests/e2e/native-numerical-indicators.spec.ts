import { expect, test } from '@playwright/test';
import type * as Charts from '../../src/index';

test('Hull smoothing draws the rounded-length warmup and independently calculated ramp', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 900, height: 600 });
  await page.route('**/hull-numerical.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><style>html,body{margin:0;background:#101010}#chart{width:900px;height:600px}</style><div id="chart"></div>',
  }));
  await page.goto('/hull-numerical.html');
  const result = await page.evaluate(async () => {
    const url = '/dist/openalgo-charts.all.mjs';
    const lib = await import(url) as typeof Charts;
    const chart = lib.createChart(document.getElementById('chart')!, {
      theme: lib.darkTheme, animZoom: false, timeNavigator: false, pixelRatio: () => 1,
    });
    chart.addSeries('candlestick').setData(Array.from({ length: 20 }, (_, i) => ({
      time: 1700000000 + i * 60, open: i + 1, high: i + 2, low: i, close: i + 1, volume: 1,
    })));
    const study = chart.addIndicator('hma', { length: 13, color: '#ff9900' });
    chart.setVisibleLogicalRange({ from: 10, to: 21 });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = chart.panes()[study.paneIndex].base.element;
    const x = chart.timeScale.indexToX(17.5);
    const y = study.series('hma')!.priceScale().priceToY(18.5 - 1 / 3);
    const pixels = canvas.getContext('2d')!.getImageData(Math.round(x - 4), Math.round(y - 4), 9, 9).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 240 && Math.abs(pixels[i + 1] - 153) < 10 && pixels[i + 2] < 10) ink++;
    }
    return { values: study.values().hma, ink };
  });
  expect(result.values.slice(0, 15)).toEqual(Array(15).fill(null));
  for (let i = 15; i < 20; i++) expect(result.values[i]).toBeCloseTo(i + 1 - 1 / 3, 12);
  expect(result.ink).toBeGreaterThan(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('hull-lengths.png') });
});

test('directional strength draws the independently calculated seed and next reading', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 900, height: 600 });
  await page.route('**/numerical-indicators.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><style>html,body{margin:0;background:#101010}#chart{width:900px;height:600px}</style><div id="chart"></div>',
  }));
  await page.goto('/numerical-indicators.html');
  const result = await page.evaluate(async () => {
    const url = '/dist/openalgo-charts.all.mjs';
    const lib = await import(url) as typeof Charts;
    const chart = lib.createChart(document.getElementById('chart')!, {
      theme: lib.darkTheme, animZoom: false, timeNavigator: false, pixelRatio: () => 1,
    });
    chart.addSeries('candlestick').setData([
      [10, 8, 9], [12, 9, 11], [11, 7, 8], [13, 9, 12], [12, 10, 11],
    ].map(([high, low, close], index) => ({
      time: 1700000000 + index * 60, open: close, high, low, close, volume: 100,
    })));
    const study = chart.addIndicator('adx', { period: 2, adxPeriod: 2, adxColor: '#ff9900' });
    chart.setVisibleLogicalRange({ from: -1, to: 5 });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const pane = chart.panes()[study.paneIndex];
    const x = chart.timeScale.indexToX(3.5);
    const y = study.series('adx')!.priceScale().priceToY(31.25);
    const pixels = pane.base.element.getContext('2d')!.getImageData(
      Math.round(x - 4), Math.round(y - 4), 9, 9,
    ).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 240 && Math.abs(pixels[i + 1] - 153) < 10 && pixels[i + 2] < 10) ink++;
    }
    return { values: study.values(), ink };
  });
  expect(result.values.adx).toEqual([null, null, null, 25, 37.5]);
  expect(result.values.plusDi[4]).toBeCloseTo(24, 12);
  expect(result.values.minusDi[4]).toBeCloseTo(8, 12);
  expect(result.ink).toBeGreaterThan(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('directional-seed.png') });
});
