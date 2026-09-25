import { test, expect, type Page } from '@playwright/test';
import type { Chart, IndicatorApi, IndicatorRequestState, ReplayController, SeriesApi } from '../../src/index';
import type { Tier2Context, Tier2Descriptor, Tier2Point } from '../../src/indicators/external';
import type * as Charts from '../../src/index';

type Request = Tier2Context & { asOf?: number; requestState?: Readonly<IndicatorRequestState> };
type Descriptor = Tier2Descriptor & { supportsReplay?: boolean };
type Library = typeof Charts & { createTier2Indicator(descriptor: Descriptor): Charts.IndicatorDescriptor };
type Control = { holdNext: boolean; held: (() => void)[]; starts: number; stops: number;
  omitAt?: number; push?: (point: Tier2Point) => void };
declare global {
  interface Window {
    __externalLifecycle: { chart: Chart; study: IndicatorApi; plot: SeriesApi; source: SeriesApi;
      requests: Request[]; control: Control; replay?: ReplayController };
  }
}
const START = 1700000000;

async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function loadExample(page: Page, options = { live: false, supportsReplay: true }) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.request.get('/website/pages/examples.mdx');
  expect(response.ok()).toBe(true);
  const code = (await response.text()).split('## External points with live revisions')[1].split('code={`')[1].split('`} />')[0];
  await page.setViewportSize({ width: 960, height: 470 });
  await page.route('**/external-lifecycle.html', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><style>html,body{margin:0;background:#101010}#example{width:960px;height:460px}</style></head><body><div id="example"></div></body></html>' }));
  await page.goto('/external-lifecycle.html');
  await page.evaluate(async ({ sourceCode, options }) => {
    const url = '/dist/openalgo-charts.all.mjs', lib = await import(url) as Library;
    const requests: Request[] = [], control: Control = { holdNext: false, held: [], starts: 0, stops: 0 };
    const instrumented = { ...lib,
      createChart: (host: HTMLElement, chartOptions: Charts.ChartOptions) =>
        lib.createChart(host, { ...chartOptions, theme: lib.darkTheme, animZoom: false, timeNavigator: false }),
      createTier2Indicator: (descriptor: Descriptor) => lib.createTier2Indicator({ ...descriptor,
        supportsReplay: options.supportsReplay,
        fetch: context => {
          requests.push(context);
          const held = control.holdNext;
          control.holdNext = false;
          return descriptor.fetch(context).then(points => {
            const response = points.filter(point => point.time !== control.omitAt);
            return held ? new Promise<readonly Tier2Point[]>(resolve => control.held.push(() => resolve(response))) : response;
          });
        },
        ...(options.live ? { subscribe: (_context: Tier2Context, push: (point: Tier2Point) => void) => {
          control.starts++; control.push = push;
          return () => { control.stops++; control.push = undefined; };
        } } : {}),
      }),
    };
    const chart = new Function('el', 'lib', sourceCode)(document.getElementById('example'), instrumented) as Chart;
    const study = chart.indicators()[0];
    window.__externalLifecycle = { chart, study, plot: study.series('value')!, source: chart.primarySeries()!, requests, control };
  }, { sourceCode: code, options });
  await paint(page);
  return errors;
}

async function release(page: Page) {
  await page.getByRole('button', { name: 'Release history', exact: true }).click();
  await paint(page);
}

async function settleReplay(page: Page) {
  await release(page);
  if (await page.evaluate(() => window.__externalLifecycle.study.dataStatus()?.state) === 'loading') await release(page);
  expect(await page.evaluate(() => window.__externalLifecycle.study.dataStatus()?.state)).toBe('ready');
}

async function inspect(page: Page, index = 11) {
  return page.evaluate(barIndex => {
    const { chart, study, plot, source, requests, control } = window.__externalLifecycle;
    const values = study.values().value;
    let ink = 0;
    if (typeof values[barIndex] === 'number') {
      const canvas = chart.panes()[study.paneIndex].base.element, context = canvas.getContext('2d')!;
      const ratio = canvas.width / 960, x = chart.timeScale.indexToX(barIndex), y = plot.priceScale().priceToY(values[barIndex]!);
      const pixels = context.getImageData(Math.round((x - 5) * ratio), Math.round((y - 5) * ratio), Math.round(10 * ratio), Math.round(10 * ratio)).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 79 && pixels[i + 1] === 140 && pixels[i + 2] === 255) ink++;
    }
    return { values, ink, status: study.dataStatus()?.state, samePlot: study.series('value') === plot,
      sourceTimes: source.getData().map(bar => bar.time), sameSource: chart.primarySeries() === source,
      starts: control.starts, stops: control.stops, held: control.held.length,
      requests: requests.map(request => ({ from: request.from, to: request.to, asOf: request.asOf ?? null,
        aborted: request.signal?.aborted ?? false, provider: request.requestState?.providerRevision ?? null })) };
  }, index);
}

test('external example refreshes fixed-time values and replaces provider ownership without stale publication', async ({ page }, info) => {
  const errors = await loadExample(page);
  await release(page);
  let state = await inspect(page);
  expect(state.status).toBe('ready');
  expect(state.values).toEqual(Array.from({ length: 12 }, (_, i) => 20 + i * 2));
  expect(state.ink).toBeGreaterThan(12);
  const times = state.sourceTimes, firstCount = state.requests.length;
  await page.screenshot({ path: info.outputPath('external-initial.png') });

  await page.getByRole('button', { name: 'Update same candle', exact: true }).click();
  await paint(page);
  expect((await inspect(page)).requests.length).toBe(firstCount + 1);
  await release(page);
  state = await inspect(page);
  expect(state.values.slice(-1)).toEqual([47]);
  expect(state.sourceTimes).toEqual(times);
  expect(state.ink).toBeGreaterThan(12);
  await page.screenshot({ path: info.outputPath('external-same-time.png') });

  await page.getByRole('button', { name: 'Revise history', exact: true }).click();
  await release(page);
  state = await inspect(page);
  expect(state.values).toEqual(Array.from({ length: 12 }, (_, i) => 30 + i * 2 + (i === 11 ? 5 : 0)));
  expect(state.requests.slice(-1)[0]).toMatchObject({ from: START, to: START + 660 });
  await page.screenshot({ path: info.outputPath('external-history-revision.png') });

  await page.evaluate(() => { window.__externalLifecycle.control.holdNext = true; });
  await page.getByRole('button', { name: 'Update same candle', exact: true }).click();
  await release(page);
  state = await inspect(page);
  expect(state.held).toBe(1);
  const obsolete = state.requests.length - 1;
  await page.evaluate(() => window.__externalLifecycle.study.setSettings({ 'value:width': 4 }));
  await paint(page);
  expect((await inspect(page)).requests.length).toBe(obsolete + 1);
  await page.getByRole('button', { name: 'Replace provider', exact: true }).click();
  await paint(page);
  state = await inspect(page);
  expect(state.requests[obsolete].aborted).toBe(true);
  expect(state.values).toEqual(new Array(12).fill(null));
  await release(page);
  const replacement = Array.from({ length: 12 }, (_, i) => 120 + i * 2);
  expect((await inspect(page)).values).toEqual(replacement);
  await page.evaluate(() => { for (const complete of window.__externalLifecycle.control.held.splice(0)) complete(); });
  await paint(page);
  state = await inspect(page);
  expect(state).toMatchObject({ values: replacement, samePlot: true, sameSource: true, sourceTimes: times });
  expect(state.ink).toBeGreaterThan(12);
  await page.screenshot({ path: info.outputPath('external-replaced.png') });

  await page.getByRole('button', { name: 'Update same candle', exact: true }).click();
  await page.evaluate(() => window.__externalLifecycle.study.remove());
  await paint(page);
  expect(await page.evaluate(() => ({ aborted: window.__externalLifecycle.requests.slice(-1)[0].signal!.aborted,
    count: window.__externalLifecycle.chart.indicators().length }))).toEqual({ aborted: true, count: 0 });
  await release(page);
  expect(errors).toEqual([]);
});

test('external replay opt-in fetches historical versions and restores live values', async ({ page }, info) => {
  const errors = await loadExample(page, { live: true, supportsReplay: true });
  await release(page);
  await page.getByRole('button', { name: 'Revise history', exact: true }).click();
  await release(page);
  expect((await inspect(page)).values[0]).toBe(30);
  await page.evaluate(async start => {
    const url = '/dist/openalgo-charts.all.mjs', lib = await import(url) as Library;
    const state = window.__externalLifecycle;
    state.replay = new lib.ReplayController(state.chart, { timing: { barEndTime: bar => bar.time + 60 }, startTime: start + 360 });
  }, START);
  await settleReplay(page);
  let state = await inspect(page, 5);
  expect(state).toMatchObject({ starts: 1, stops: 1 });
  expect(state.requests.slice(-1)[0].asOf).toBe(START + 360);
  expect(state.values).toEqual([20, 22, 24, 26, 28, 30]);
  expect(state.ink).toBeGreaterThan(12);
  await page.screenshot({ path: info.outputPath('external-replay-before-revision.png') });

  await page.evaluate(start => {
    const state = window.__externalLifecycle;
    state.control.omitAt = start + 240;
    state.replay!.seekTime(start + 660);
  }, START);
  await settleReplay(page);
  state = await inspect(page, 10);
  expect(state.requests.slice(-1)[0]).toMatchObject({ from: START, to: START + 600, asOf: START + 660 });
  expect(state.values).toEqual([30, 32, 34, 36, 36, 40, 42, 44, 46, 48, 50]);
  expect(state.ink).toBeGreaterThan(12);
  await page.screenshot({ path: info.outputPath('external-replay-after-revision.png') });

  await page.evaluate(start => {
    const state = window.__externalLifecycle;
    state.control.omitAt = undefined;
    state.replay!.seekTime(start + 360);
  }, START);
  await settleReplay(page);
  expect((await inspect(page, 5)).values).toEqual([20, 22, 24, 26, 28, 30]);
  await page.evaluate(() => window.__externalLifecycle.replay!.stop());
  await settleReplay(page);
  state = await inspect(page);
  expect(state.values).toEqual(Array.from({ length: 12 }, (_, i) => 30 + i * 2));
  expect(state.requests.slice(-1)[0].asOf).toBeNull();
  expect(state.starts).toBeGreaterThanOrEqual(2);
  expect(state.starts - state.stops).toBe(1);
  await page.screenshot({ path: info.outputPath('external-live-restored.png') });
  await page.evaluate(async () => {
    const url = '/dist/openalgo-charts.all.mjs', lib = await import(url) as Library;
    const state = window.__externalLifecycle;
    state.replay = new lib.ReplayController(state.chart, { startIndex: 5 });
  });
  await paint(page);
  state = await inspect(page, 5);
  expect(state).toMatchObject({ status: 'unsupported', values: new Array(6).fill(null) });
  expect(state.starts).toBe(state.stops);
  await page.screenshot({ path: info.outputPath('external-legacy-unsupported.png') });
  await page.evaluate(() => window.__externalLifecycle.chart.destroy());
  expect(errors).toEqual([]);
});

test('live external sources refresh explicitly and stop subscriptions at replay boundaries', async ({ page }, info) => {
  const errors = await loadExample(page, { live: true, supportsReplay: false });
  await release(page);
  const first = await inspect(page);
  expect(first).toMatchObject({ starts: 1, stops: 0 });
  await page.getByRole('button', { name: 'Update same candle', exact: true }).click();
  await paint(page);
  expect((await inspect(page)).requests.length).toBe(first.requests.length);
  await page.evaluate(start => window.__externalLifecycle.control.push!({ time: start + 660, values: { value: 99 } }), START);
  await paint(page);
  expect((await inspect(page)).values.slice(-1)).toEqual([99]);
  await page.getByRole('button', { name: 'Revise history', exact: true }).click();
  await release(page);
  let state = await inspect(page);
  expect(state.values[0]).toBe(30);
  expect(state.values.slice(-1)).toEqual([57]);
  expect(state.requests.slice(-1)[0]).toMatchObject({ from: START, to: START + 660 });
  await page.screenshot({ path: info.outputPath('external-live-refresh.png') });

  await page.evaluate(async start => {
    const url = '/dist/openalgo-charts.all.mjs', lib = await import(url) as Library;
    const state = window.__externalLifecycle;
    state.replay = new lib.ReplayController(state.chart, { timing: { barEndTime: bar => bar.time + 60 }, startTime: start + 360 });
  }, START);
  await paint(page);
  state = await inspect(page, 5);
  expect(state).toMatchObject({ status: 'unsupported', values: new Array(6).fill(null), starts: 1, stops: 1 });
  await page.screenshot({ path: info.outputPath('external-replay-unsupported.png') });
  await page.evaluate(() => window.__externalLifecycle.replay!.stop());
  await settleReplay(page);
  state = await inspect(page);
  expect(state.status).toBe('ready');
  expect(state.starts).toBeGreaterThanOrEqual(2);
  expect(state.starts - state.stops).toBe(1);
  await page.evaluate(() => window.__externalLifecycle.chart.destroy());
  expect(await page.evaluate(() => {
    const { starts, stops } = window.__externalLifecycle.control;
    return starts - stops;
  })).toBe(0);
  expect(errors).toEqual([]);
});
