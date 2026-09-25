import { expect, test, type Page } from '@playwright/test';
import type { Widget } from '../../src/widget/widget';
import type * as Charts from '../../src/index';
import type * as Widgets from '../../src/widget/index';

// Go to a date or range in both hosts. The widget half serves daily sessions
// stamped at the 09:15 open by date window, so a date before the first load
// needs one reach of older history; the reference half widens its period.
// Both check where the view landed by time, and that the plot is painted
// there rather than left on an empty stretch of axis.

const ORIGIN = `http://127.0.0.1:${process.env.OAC_E2E_DEMO_PORT || '8124'}`;

declare global {
  interface Window {
    __goto: { widget: Widget; requests: number; at(y: number, m: number, d: number, hh?: number, mm?: number): number };
  }
}

async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function mountWidget(page: Page, width: number) {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 760 });
  await page.route('**/date-navigation.html', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><style>html,body{margin:0;background:#0d0e12}#host{position:absolute;inset:0}</style></head><body><div id="host"></div></body></html>' }));
  await page.goto('/date-navigation.html');
  await page.evaluate(async () => {
    const lib = await import('/dist/openalgo-charts.mjs' as string) as typeof Charts;
    const widgets = await import('/dist/openalgo-charts.widget.mjs' as string) as typeof Widgets;
    const at = (y: number, m: number, d: number, hh = 0, mm = 0): number => lib.zonedWallClockToUtcSeconds(y, m, d, hh, mm, 0, 'Asia/Kolkata');
    const sessions: Charts.Bar[] = [];
    for (let day = 0; ; day++) {
      const time = at(2023, 1, 2 + day, 9, 15);
      if (time > at(2024, 6, 28, 23, 59)) break;
      const weekday = new Date((time + 19800) * 1000).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const close = 100 + Math.sin(sessions.length / 7) * 8 + sessions.length * 0.05;
      sessions.push({ time, open: close - 0.5, high: close + 1.2, low: close - 1.4, close: close + 0.4, volume: 1000 + sessions.length });
    }
    const state = { widget: null as unknown as Widget, requests: 0, at };
    state.widget = widgets.createWidget(document.getElementById('host')!, {
      feed: { getBars: async request => {
        state.requests++;
        return sessions.filter(value => value.time >= (request.from ?? -Infinity) && value.time <= (request.to ?? Infinity));
      } },
      symbol: 'SESSIONS', exchange: 'NSE', interval: '1d', lookbackBars: 60, theme: 'dark', rail: false,
      now: () => at(2024, 6, 28, 16, 0) * 1000, animZoom: false, animAutoscale: false,
    });
    window.__goto = state;
    await new Promise<void>(resolve => { state.widget.on('data', () => resolve()); });
  });
  await paint(page);
  return errors;
}

async function openPanel(page: Page, width: number) {
  if (width > 640) await page.getByRole('button', { name: 'Go to', exact: true }).click();
  else {
    await page.locator('[data-mobile-action="more"]').click();
    await page.locator('[data-mobile-action="go-to"]').click();
  }
  const panel = page.locator('.oac-goto');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
  return panel;
}

/** Bar time at the centre of the view, and how many plot pixels differ from the background there. */
async function landing(page: Page) {
  return page.evaluate(() => {
    const chart = window.__goto.widget.chart;
    const view = chart.getVisibleLogicalRange();
    const centre = chart.dataLayer.indexToTime(Math.round((view.from + view.to) / 2));
    const shot = chart.takeScreenshot();
    const ctx = shot.getContext('2d')!;
    const x = Math.round(shot.width * 0.4);
    const band = ctx.getImageData(x, 0, Math.round(shot.width * 0.2), shot.height).data;
    const bg = ctx.getImageData(1, 1, 1, 1).data;
    let painted = 0;
    for (let i = 0; i < band.length; i += 4) {
      if (Math.abs(band[i] - bg[0]) + Math.abs(band[i + 1] - bg[1]) + Math.abs(band[i + 2] - bg[2]) > 60) painted++;
    }
    return { centre, painted, range: view };
  });
}

for (const width of [1100, 390]) {
  test(`widget go-to loads missing history and paints the placed date at ${width}px`, async ({ page }, info) => {
    const errors = await mountWidget(page, width);
    const before = await page.evaluate(() => window.__goto.requests);
    const panel = await openPanel(page, width);
    await panel.locator('input[type=date]').first().fill('2023-10-16');
    await panel.locator('input[type=time]').first().fill('');
    await panel.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(panel).toBeHidden();
    await paint(page);
    const placed = await landing(page);
    expect(placed.centre).toBe(await page.evaluate(() => window.__goto.at(2023, 10, 16, 9, 15)));
    expect(await page.evaluate(() => window.__goto.requests)).toBe(before + 1);
    expect(placed.painted).toBeGreaterThan(200);
    await page.screenshot({ path: info.outputPath('placed.png') });
    expect(errors).toEqual([]);
  });
}

test('widget go-to explains an empty request in place and fits a range', async ({ page }, info) => {
  const errors = await mountWidget(page, 1100);
  const view = await page.evaluate(() => window.__goto.widget.chart.getVisibleLogicalRange());
  let panel = await openPanel(page, 1100);
  await panel.locator('input[type=date]').first().fill('2030-01-01');
  await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel.locator('.oac-goto__message')).toContainText('No bars at or after');
  expect(await page.evaluate(() => window.__goto.widget.chart.getVisibleLogicalRange())).toEqual(view);
  await page.screenshot({ path: info.outputPath('no-data.png') });

  await panel.getByRole('button', { name: 'Range', exact: true }).click();
  const dates = panel.locator('input[type=date]');
  await dates.nth(0).fill('2024-03-04');
  await dates.nth(1).fill('2024-03-28');
  await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel).toBeHidden();
  await paint(page);
  const edges = await page.evaluate(() => {
    const chart = window.__goto.widget.chart;
    const range = chart.getVisibleLogicalRange();
    return [chart.dataLayer.indexToTime(Math.ceil(range.from)), chart.dataLayer.indexToTime(Math.floor(range.to))];
  });
  expect(edges).toEqual(await page.evaluate(() => [window.__goto.at(2024, 3, 4, 9, 15), window.__goto.at(2024, 3, 28, 9, 15)]));
  expect((await landing(page)).painted).toBeGreaterThan(200);
  await page.screenshot({ path: info.outputPath('range.png') });

  panel = await openPanel(page, 1100);
  await expect(panel.getByRole('button', { name: 'Range', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('reference host go-to widens its period and places the date', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(ORIGIN + '/examples/yfinance/index.html?test=1');
  await page.waitForFunction(() => (window as any).__oac?.app.chart && !(window as any).__oac.app.loading);
  // A month on screen, so a date two hundred days back needs a longer period.
  await page.getByRole('button', { name: 'History range' }).click();
  await page.locator('.menu button', { hasText: '1mo' }).click();
  await page.waitForFunction(() => (window as any).__oac.app.req.period === '1mo' && !(window as any).__oac.app.loading);
  const target = await page.evaluate(() => {
    const zone = (window as any).__oac.app.chart.timezone();
    const date = new Date(Date.now() - 200 * 86400_000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return parts;
  });
  await page.getByRole('button', { name: 'Go to a date or range' }).click();
  const panel = page.locator('.oac-goto');
  await expect(panel).toBeVisible();
  await panel.locator('input[type=date]').first().fill(target);
  await panel.locator('input[type=time]').first().fill('');
  await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel).toBeHidden({ timeout: 20_000 });
  const outcome = await page.evaluate(async (day: string) => {
    const lib = await import('/dist/openalgo-charts.mjs' as string) as typeof Charts;
    const app = (window as any).__oac.app;
    const chart = app.chart as Charts.Chart;
    const zone = chart.timezone();
    const [y, m, d] = day.split('-').map(Number);
    const start = lib.zonedWallClockToUtcSeconds(y, m, d, 0, 0, 0, zone);
    const expected = chart.primaryBars().find(value => lib.startOfZonedDay(value.time, zone) + 86400 > start)?.time;
    const view = chart.getVisibleLogicalRange();
    return { period: app.req.period, expected, centre: chart.dataLayer.indexToTime(Math.round((view.from + view.to) / 2)), first: chart.primaryBars()[0].time, start };
  }, target);
  expect(outcome.period).toBe('1y');
  expect(outcome.first).toBeLessThanOrEqual(outcome.start);
  expect(outcome.centre).toBe(outcome.expected);
  await page.screenshot({ path: info.outputPath('reference-placed.png') });
  expect(errors).toEqual([]);
});
