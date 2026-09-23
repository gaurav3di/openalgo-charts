import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type Locator } from '@playwright/test';

const ORIGIN = `http://127.0.0.1:${process.env.OAC_E2E_DEMO_PORT || '8124'}`;

async function reference(page: Page) {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(ORIGIN + '/examples/yfinance/index.html?test=1');
  await page.waitForFunction(() => (window as any).__oac?.app.chart && !(window as any).__oac.app.loading);
}
async function csv(page: Page, button: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing downloaded CSV');
  return { filename: download.suggestedFilename(), rows: (await readFile(path, 'utf8')).trimEnd().split('\r\n').map(row => row.split(',')) };
}

test('reference layouts download the captured chart with OI studies and aligned comparisons', async ({ page }, info) => {
  await reference(page);
  await page.getByRole('button', { name: /Open a second, linked chart/ }).click();
  await page.waitForFunction(() => (window as any).__oac.app.chart2 && !(window as any).__oac.app.loading2);
  const expected = await page.evaluate(async () => {
    const app = (window as any).__oac.app, chart = app.chart2, bars = chart.primaryBars();
    chart.primarySeries().update({ ...bars.at(-1), oi: 0 });
    const study = chart.addIndicator('ema', { length: 2 });
    const path = '/dist/openalgo-charts.mjs', { addComparison } = await import(path);
    addComparison(chart, { symbol: 'COMPARED', bars: chart.primaryBars().filter((_: unknown, index: number) => index % 2 === 0)
      .map((bar: any) => ({ ...bar, close: bar.close + 50 })) });
    return { count: bars.length, first: bars[0], last: chart.primaryBars().at(-1), study: study.id };
  });
  await page.locator('#chart2').focus();
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Layouts', exact: true });
  await expect(dialog.locator('#ws-data-source')).toContainText('Chart 2: MSFT');
  await page.evaluate(() => { (window as any).__oac.app.focusPane = 1; });
  const result = await csv(page, dialog.getByRole('button', { name: 'Download chart data (CSV)', exact: true }));
  expect(result.filename).toMatch(/^MSFT-1h-candlestick-.*\.csv$/);
  expect(result.rows).toHaveLength(expected.count + 1);
  expect(result.rows[0]).toEqual(expect.arrayContaining(['time', 'oi', `indicator:${expected.study}:ma`, 'comparison:1:COMPARED:close']));
  expect(result.rows[1].slice(0, 7)).toEqual([expected.first.time, expected.first.open, expected.first.high,
    expected.first.low, expected.first.close, expected.first.volume, ''].map(String));
  expect(result.rows.at(-1)![6]).toBe('0');
  const comparison = result.rows[0].indexOf('comparison:1:COMPARED:close');
  expect(result.rows[1][comparison]).toBe(String(expected.first.close + 50));
  expect(result.rows[2][comparison]).toBe('');
  await page.screenshot({ path: info.outputPath('data-export-layout.png') });
  await page.setViewportSize({ width: 390, height: 740 });
  const button = dialog.getByRole('button', { name: 'Download chart data (CSV)', exact: true });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('data-export-narrow.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.evaluate(() => {
    const app = (window as any).__oac.app;
    app.focusPane = 2; app.p2.chartType = 't:heikin-ashi'; app.rebuildSecondary({ typeChanged: true });
  });
  await page.getByRole('button', { name: 'Chart snapshot', exact: true }).click();
  const transformed = await csv(page, page.locator('#snap-data'));
  expect(transformed.filename).toMatch(/^MSFT-1h-heikin-ashi-/);
  expect(Number(transformed.rows[1][4])).toBe((expected.first.open + expected.first.high + expected.first.low + expected.first.close) / 4);
});

test('reference data downloads honor replay and reject an obsolete snapshot menu owner', async ({ page }) => {
  await reference(page);
  const prefix = await page.evaluate(async () => {
    const app = (window as any).__oac.app, path = '/examples/yfinance/src/replay.js', replay = await import(path);
    const last = app.chart.primaryBars().at(-1).time;
    replay.enterReplay(); await replay.startReplayAt(Math.floor(app.currentBars.length / 2));
    return { count: app.chart.primaryBars().length, last: app.chart.primaryBars().at(-1).time, future: last };
  });
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Layouts', exact: true });
  const result = await csv(page, dialog.getByRole('button', { name: 'Download chart data (CSV)', exact: true }));
  expect(result.filename).toContain('-replay-');
  expect(result.rows).toHaveLength(prefix.count + 1); expect(Number(result.rows.at(-1)![0])).toBe(prefix.last);
  expect(result.rows.slice(1).some(row => Number(row[0]) === prefix.future)).toBe(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Chart snapshot', exact: true }).click();
  await page.evaluate(() => { (window as any).__oac.app.req.symbol = 'CHANGED'; });
  await page.locator('#snap-data').click();
  await expect(page.locator('#status')).toContainText('changed');
});

test('widget capture downloads actual CSV and reports browser file failures', async ({ page }, info) => {
  await page.goto('/tests/e2e/widget-fixture.html');
  await page.waitForFunction(() => (window as any).__loaded > 0);
  const expected = await page.evaluate(() => {
    const widget = (window as any).__widget, bars = widget.chart.primaryBars();
    widget.series.update({ ...bars.at(-1), oi: 0 });
    return { count: bars.length, last: bars.at(-1).time };
  });
  await page.getByRole('button', { name: 'Capture chart', exact: true }).click();
  await page.screenshot({ path: info.outputPath('widget-data-export.png') });
  const result = await csv(page, page.getByRole('menuitemradio', { name: /Download chart data \(CSV\)/ }));
  expect(result.filename).toMatch(/^FIXTURE-5m-.*\.csv$/);
  expect(result.rows).toHaveLength(expected.count + 1); expect(Number(result.rows.at(-1)![0])).toBe(expected.last);
  expect(result.rows.at(-1)![6]).toBe('0');
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('Download refused'); }; });
  await page.getByRole('button', { name: 'Capture chart', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /Download chart data \(CSV\)/ }).click();
  await expect(page.locator('.oac-statusline__msg')).toContainText('Download refused');
});

test('widget refuses CSV after its capture menu source changes', async ({ page }) => {
  await page.goto('/tests/e2e/widget-fixture.html');
  await page.waitForFunction(() => (window as any).__loaded > 0);
  await page.getByRole('button', { name: 'Capture chart', exact: true }).click();
  await page.evaluate(() => (window as any).__widget.setSymbol('CHANGED'));
  await page.getByRole('menuitemradio', { name: /Download chart data \(CSV\)/ }).click();
  await expect(page.locator('.oac-statusline__msg')).toContainText('changed');
});
