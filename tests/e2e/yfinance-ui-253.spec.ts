import { test, expect } from '@playwright/test';

const PAGE = '/examples/yfinance/index.html?test=1';
const PROBE = '/api/history?symbol=AAPL&interval=1d&period=1mo';
let serverUp: boolean | null = null;

test.beforeEach(async ({ request, page }) => {
  if (serverUp === null) serverUp = await request.get(PROBE).then(response => response.ok(), () => false);
  test.skip(!serverUp, 'The reference fixture server is unavailable');
  await page.goto(PAGE);
  await page.waitForFunction(() => Boolean((window as any).__oac?.app?.currentBars?.length));
});

test('the selected chart shares a resizable Data and Objects dock', async ({ page }) => {
  const plot = page.locator('#chart');
  const before = await plot.evaluate(element => element.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Data window', exact: true }).click();
  const dock = page.locator('#inspect-layout-1 .oac-panel-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Open');
  expect(await plot.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(before);
  await page.getByRole('button', { name: 'Chart objects', exact: true }).click();
  await expect(dock.getByRole('searchbox', { name: 'Search objects' })).toBeVisible();
  await dock.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dock).toBeHidden();
});

test('symbol results preserve an explicit venue and direct interval entry owns the focused chart', async ({ page }) => {
  await page.getByRole('button', { name: 'Change symbol', exact: true }).click();
  const input = page.getByPlaceholder('Symbol or expression');
  await input.fill('reliance');
  await page.getByRole('option', { name: /NSE:RELIANCE\.NS/ }).click();
  await page.waitForFunction(() => (window as any).__oac?.app?.req?.symbol === 'RELIANCE.NS');
  await page.locator('#chart').focus();
  await page.keyboard.press('1');
  const interval = page.locator('.oac-quick-entry__input');
  await expect(interval).toBeVisible();
  await interval.fill('15');
  await interval.press('Enter');
  await page.waitForFunction(() => (window as any).__oac?.app?.req?.interval === '15m');
});

test('the shared indicator picker manages duplicate running instances independently', async ({ page }) => {
  await page.getByRole('button', { name: 'Add an indicator', exact: true }).click();
  const ema = page.locator('.oac-pick__row[data-id="ema"]');
  await ema.click();
  await ema.click();
  const before = await page.evaluate(() => (window as any).__oac.app.chart.indicators().filter((item: any) => item.indicatorId === 'ema').map((item: any) => item.id));
  expect(before).toHaveLength(2);
  const running = page.locator(before.map((id: string) => `.oac-pick__running-row[data-instance-id="${id}"]`).join(', '));
  await expect(running).toHaveCount(2);
  await page.locator(`.oac-pick__running-row[data-instance-id="${before[0]}"]`).getByRole('button', { name: /Remove/ }).click();
  const after = await page.evaluate(() => (window as any).__oac.app.chart.indicators().filter((item: any) => item.indicatorId === 'ema').map((item: any) => item.id));
  expect(after).toHaveLength(1);
  expect(before).toContain(after[0]);
});
