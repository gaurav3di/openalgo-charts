import { test, expect, type Page } from '@playwright/test';

// The reference host's grid view over the fixture server: four instruments,
// presets, links and persistence, and the hand-off from the main page of a
// layout whose geometry only the grid view can draw.
const ORIGIN = `http://127.0.0.1:${process.env.OAC_E2E_DEMO_PORT || '8124'}`;

test.use({ viewport: { width: 1360, height: 900 } });
test.beforeEach(async ({ request }) => {
  const up = await request.get(ORIGIN + '/api/history?symbol=AAPL&interval=1d&period=1mo').then(r => r.ok(), () => false);
  test.skip(!up, 'the yfinance fixture server is not available');
});

const grid = <T>(page: Page, fn: (grid: any) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__grid)`) as Promise<T>;
const loaded = (page: Page): Promise<boolean> => grid(page, g => g.cells().every((cell: any) => cell.widget.series.getData().length > 0));

test('the grid view loads four instruments, switches presets and links, and keeps them across a reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(ORIGIN + '/examples/yfinance/grid.html?test=1');
  await page.waitForFunction(() => (window as any).__grid?.cells().length === 4);
  await expect.poll(() => loaded(page), { timeout: 20_000 }).toBe(true);
  expect(await grid(page, g => g.cells().map((cell: any) => cell.widget.symbol()))).toEqual(['AAPL', 'MSFT', 'RELIANCE.NS', '^NSEI']);
  await expect(page.getByRole('button', { name: 'Two by two' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('yfinance-grid-2x2.png') });

  await page.locator('.oac-grid__cell .oac-chart').nth(1).click();
  await page.getByRole('button', { name: 'Two columns' }).click();
  await expect(page.locator('.oac-grid__cell')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Two columns' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Symbol', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Symbol', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => grid(page, g => g.cells().map((cell: any) => cell.widget.symbol()))).toEqual(['MSFT', 'MSFT']);
  await expect.poll(() => loaded(page), { timeout: 20_000 }).toBe(true);

  await page.reload();
  await page.waitForFunction(() => (window as any).__grid?.cells().length === 2);
  expect(await grid(page, g => g.cells().map((cell: any) => cell.widget.symbol()))).toEqual(['MSFT', 'MSFT']);
  expect(await grid(page, g => g.linkOptions().symbol)).toBe(true);
  await expect(page.getByRole('button', { name: 'Two columns' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => loaded(page), { timeout: 20_000 }).toBe(true);
  await page.screenshot({ path: info.outputPath('yfinance-grid-restored.png') });
  expect(errors).toEqual([]);
});

test('the main page hands a layout it cannot draw to the grid view, which opens it whole', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(ORIGIN + '/examples/yfinance/index.html?test=1');
  await page.waitForFunction(() => (window as any).__oac?.app.chart && !(window as any).__oac.app.loading);
  const pane = (id: string, symbol: string) => ({ id, symbol, exchange: '', interval: '1d', chartType: 'candlestick',
    chart: { version: 1 }, settings: {}, volume: true, magnet: 'off', stay: false, comparisons: [], comparisonMode: 'percent' });
  const desk = { kind: 'workspace', version: 1, id: 'desk', name: 'Desk', createdAt: 1, updatedAt: 1,
    panes: [pane('a', 'AAPL'), pane('b', 'MSFT'), pane('c', 'TSLA'), pane('d', 'NVDA')], activePaneId: 'c',
    layout: { rows: 2, columns: 2, slots: ['a', 'b', 'c', 'd'].map((paneId, i) => ({ paneId, row: Math.floor(i / 2), column: i % 2, rowSpan: 1, columnSpan: 1 })) },
    sync: { crosshair: true, viewport: false, symbol: false, interval: false } };
  await page.getByRole('button', { name: 'Layouts', exact: true }).click();
  await page.locator('#ws-file').setInputFiles({ name: 'desk.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(desk)) });
  await expect(page.locator('#ws-notice')).toContainText('grid view');
  await page.screenshot({ path: info.outputPath('yfinance-grid-handoff.png') });
  await page.getByRole('button', { name: 'Open in grid view' }).click();
  await page.waitForURL(/grid\.html/);
  await expect(page.locator('.oac-grid__cell')).toHaveCount(4);
  await expect(page.locator('#grid-status')).toContainText('Opened the layout from the main view: 4 charts');
  await expect(page.locator('.oac-grid__cell').nth(2)).toHaveAttribute('data-active', 'true');
  await page.screenshot({ path: info.outputPath('yfinance-grid-opened.png') });
  expect(errors).toEqual([]);
});
