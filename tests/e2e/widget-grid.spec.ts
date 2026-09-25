import { test, expect, type Page } from '@playwright/test';
import { VERSION } from '../../src/version';

// The chart grid in a real browser: layout, measured charts, splitters,
// keyboard routing, the compact view and all-or-nothing workspace import.
async function mount(page: Page, preset = '2x2', size = { width: 1200, height: 800 }): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto(`/tests/e2e/widget-grid-fixture.html?preset=${preset}`);
  await page.waitForFunction(version => (window as any).fixture?.version === version, VERSION);
  return errors;
}
const counts = (page: Page): Promise<number[]> => page.evaluate(() => (window as any).fixture.counts());
const ranges = (page: Page): Promise<Array<{ from: number; to: number }>> => page.evaluate(() => (window as any).fixture.ranges());
/**
 * True once a chart has drawn candles, not just its background, grid and
 * axes: those are grey, and the candles are the only saturated pixels.
 */
const painted = (page: Page, index: number): Promise<boolean> => page.evaluate(i => {
  const canvases = [...document.querySelectorAll('.oac-grid__cell')[i].querySelectorAll('.oac-chart canvas')] as HTMLCanvasElement[];
  let saturated = 0;
  for (const canvas of canvases) {
    if (canvas.width === 0 || canvas.height === 0) continue;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < data.length; p += 4) {
      if (data[p + 3] > 128 && Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) > 60) saturated++;
    }
  }
  return saturated > 500;
}, index);
const activeIndex = (page: Page): Promise<number> => page.evaluate(() => {
  const grid = (window as any).fixture.grid;
  return grid.cells().findIndex((cell: any) => cell.id === grid.active().id);
});

test('a two by two grid lays out four measured charts that load on their own', async ({ page }, info) => {
  const errors = await mount(page);
  const cells = page.locator('.oac-grid__cell');
  await expect(cells).toHaveCount(4);
  const boxes = await Promise.all([0, 1, 2, 3].map(i => cells.nth(i).boundingBox()));
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[0]!.y).toBeLessThan(boxes[2]!.y);
  for (const box of boxes) {
    expect(box!.width).toBeGreaterThan(500);
    expect(box!.height).toBeGreaterThan(300);
  }
  await page.evaluate(() => {
    const grid = (window as any).fixture.grid;
    grid.cells().forEach((cell: any, i: number) => cell.widget.setSymbol(['AAA', 'BBB', 'CCC', 'DDD'][i]));
  });
  await expect(page.locator('.oac-data-status').first()).toContainText('Loading');
  await page.evaluate(() => (window as any).fixture.readyAll());
  await expect.poll(() => counts(page)).toEqual([120, 120, 120, 120]);
  const plots = await page.locator('.oac-grid__cell .oac-chart').evaluateAll(els => els.map(el => [el.clientWidth, el.clientHeight]));
  for (const [width, height] of plots) {
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(200);
  }
  await page.screenshot({ path: info.outputPath('grid-2x2.png') });
  expect(errors).toEqual([]);
});

test('the active chart shows its outline and takes the keyboard while another is hovered', async ({ page }, info) => {
  const errors = await mount(page, '1x2');
  await page.evaluate(() => (window as any).fixture.readyAll());
  await expect.poll(() => counts(page)).toEqual([120, 120]);
  const charts = page.locator('.oac-grid__cell .oac-chart');
  await charts.nth(1).click();
  expect(await activeIndex(page)).toBe(1);
  const outline = await page.locator('.oac-grid__cell').nth(1).evaluate(el => getComputedStyle(el, '::after').borderTopColor);
  expect(outline).not.toBe('rgba(0, 0, 0, 0)');
  await charts.nth(0).hover();
  const before = await ranges(page);
  await page.keyboard.press('ArrowLeft');
  const after = await ranges(page);
  expect(after[0]).toEqual(before[0]);
  expect(after[1]).not.toEqual(before[1]);
  await charts.nth(0).click();
  expect(await activeIndex(page)).toBe(0);
  await page.screenshot({ path: info.outputPath('grid-active.png') });
  expect(errors).toEqual([]);
});

test('splitters resize by drag and by keyboard, and a double click evens them', async ({ page }, info) => {
  const errors = await mount(page, '1x2');
  await page.evaluate(() => (window as any).fixture.readyAll());
  const split = page.locator('.oac-grid__split');
  await expect(split).toHaveCount(1);
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  const first = page.locator('.oac-grid__cell').first();
  const start = (await first.boundingBox())!;
  const box = (await split.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const wider = (await first.boundingBox())!;
  expect(wider.width).toBeGreaterThan(start.width + 150);
  await expect.poll(() => first.locator('.oac-chart').evaluate(el => el.clientWidth)).toBeGreaterThan(start.width + 100);
  const value = Number(await split.getAttribute('aria-valuenow'));
  await split.focus();
  await page.keyboard.press('ArrowLeft');
  expect(Number(await split.getAttribute('aria-valuenow'))).toBeLessThan(value);
  await split.dblclick();
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: info.outputPath('grid-split.png') });
  expect(errors).toEqual([]);
});

test('a narrow grid shows the active chart alone with tabs, and widening restores the grid', async ({ page }, info) => {
  const errors = await mount(page, '2x2', { width: 480, height: 720 });
  await page.evaluate(() => (window as any).fixture.readyAll());
  await expect.poll(() => counts(page)).toEqual([120, 120, 120, 120]);
  const tabs = page.locator('.oac-grid__tab');
  await expect(tabs).toHaveCount(4);
  await expect(page.locator('.oac-grid__cell:visible')).toHaveCount(1);
  const only = (await page.locator('.oac-grid__cell:visible').boundingBox())!;
  expect(only.width).toBeGreaterThan(460);
  // Linked viewports reach the charts hidden behind the tabs as well.
  await page.evaluate(() => {
    const grid = (window as any).fixture.grid;
    grid.setLinks({ viewport: true });
    grid.cells()[0].widget.chart.setVisibleLogicalRange({ from: 30, to: 60 });
  });
  await tabs.nth(2).click();
  expect(await activeIndex(page)).toBe(2);
  await expect(page.locator('.oac-grid__cell').nth(2)).toBeVisible();
  await expect(page.locator('.oac-grid__split:visible')).toHaveCount(0);
  await expect.poll(() => painted(page, 2)).toBe(true);
  const near = (range: { from: number; to: number }): boolean => Math.abs(range.from - 30) < 0.01 && Math.abs(range.to - 60) < 0.01;
  await expect.poll(async () => near((await ranges(page))[2])).toBe(true);
  await page.screenshot({ path: info.outputPath('grid-compact.png') });
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('.oac-grid__cell:visible')).toHaveCount(4);
  await expect(page.locator('.oac-grid__tabs')).toBeHidden();
  await expect.poll(async () => (await ranges(page)).every(near)).toBe(true);
  for (const index of [0, 1, 2, 3]) await expect.poll(() => painted(page, index)).toBe(true);
  await page.screenshot({ path: info.outputPath('grid-widened.png') });
  expect(errors).toEqual([]);
});

test('importing a workspace replaces every chart at once, and a failed import changes nothing', async ({ page }, info) => {
  const errors = await mount(page, '1x2');
  await page.evaluate(() => (window as any).fixture.readyAll());
  const outcome = await page.evaluate(() => {
    const grid = (window as any).fixture.grid;
    const before = grid.cells().map((cell: any) => cell.widget);
    const broken = grid.getWorkspace();
    broken.panes[1].chart.version = 99;
    const failed = grid.applyWorkspace(broken);
    const kept = grid.cells().every((cell: any, i: number) => cell.widget === before[i] && !cell.widget.isDestroyed);
    const next = grid.getWorkspace();
    const pane = next.panes[0];
    next.panes = ['w', 'x', 'y'].map((id, i) => ({ ...pane, id, symbol: ['EEE', 'FFF', 'GGG'][i] }));
    next.layout = { rows: 2, columns: 2, rowWeights: [1.5, 1], columnWeights: [1, 1], slots: [
      { paneId: 'w', row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
      { paneId: 'x', row: 1, column: 0, rowSpan: 1, columnSpan: 1 },
      { paneId: 'y', row: 1, column: 1, rowSpan: 1, columnSpan: 1 },
    ] };
    next.activePaneId = 'y';
    const applied = grid.applyWorkspace(next);
    return { failed, kept, applied, destroyed: before.every((widget: any) => widget.isDestroyed) };
  });
  expect(outcome.failed.applied).toBe(false);
  expect(outcome.kept).toBe(true);
  expect(outcome.applied).toEqual({ applied: true });
  expect(outcome.destroyed).toBe(true);
  await expect(page.locator('.oac-widget')).toHaveCount(3);
  await page.evaluate(() => (window as any).fixture.readyAll());
  await expect.poll(() => counts(page)).toEqual([120, 120, 120]);
  const wide = (await page.locator('.oac-grid__cell').nth(0).boundingBox())!;
  const low = (await page.locator('.oac-grid__cell').nth(1).boundingBox())!;
  expect(wide.width).toBeGreaterThan(low.width * 1.8);
  expect(wide.height).toBeGreaterThan(low.height * 1.3);
  await expect(page.locator('.oac-grid__split')).toHaveCount(2);
  expect(await activeIndex(page)).toBe(2);
  await page.screenshot({ path: info.outputPath('grid-imported.png') });
  expect(errors).toEqual([]);
});
