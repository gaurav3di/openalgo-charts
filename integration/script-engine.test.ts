import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticBag, check, emit, isError, parse, sourceFile } from 'script-engine-under-test';
import { descriptorFor } from 'script-engine-under-test/adapters/charts';
import { Chart } from '../src/core/chart';
import { registerIndicator, type IndicatorDescriptor } from '../src/model/indicator-registry';
import type { Bar } from '../src/model/bar';
import type { SeriesMarker } from '../src/primitives/markers';
import { ChartTable } from '../src/primitives/table';
import { securityExpression } from '../src/indicators/security';
import { alignRequestedExpression, type RequestedExpression } from '../src/indicators/requested-context';
import { createRequestedIndicator } from '../src/indicators/requested-indicator';
import { createTier2Indicator } from '../src/indicators/external';
import { SMA } from '../src/indicators/trend';
import { ReplayController } from '../src/replay/controller';
import { fakeDocument } from '../tests/helpers/fake-dom';

const charts: Chart[] = [];
let sequence = 0;
afterEach(() => charts.splice(0).forEach(chart => chart.destroy()));

function compile(text: string): IndicatorDescriptor {
  const file = sourceFile('compatibility.oscript', text);
  const bag = new DiagnosticBag();
  const ast = parse(file, bag);
  const checked = check(file, ast, bag);
  const result = emit(file, checked, bag, {});
  const errors = bag.ordered().filter(isError);
  expect(errors.map(error => `${error.code}: ${error.message}`)).toEqual([]);
  if (!result.program) throw new Error('script engine emitted no program');
  // This assignment is checked against the actual public adapter declarations.
  // The integration runner fails compilation if the chart contract drifts.
  const descriptor: IndicatorDescriptor = descriptorFor(result.program, { id: `script-compat-${sequence++}` });
  return descriptor;
}

function makeChart(data: Bar[], now: number, updatesOnly = false) {
  const clock = { now };
  const document = fakeDocument();
  const chart = new Chart(document.createElement('div'), {
    document, timezone: 'Etc/UTC', pixelRatio: () => 1, shortcuts: false,
    axisChrome: { clock: () => clock.now },
    raf: { schedule: () => 1, cancel: () => {} },
  });
  charts.push(chart);
  chart.applySize(800, 600);
  chart.setDataContext({ symbol: 'SAMPLE', interval: '1m' });
  const series = chart.addSeries('candlestick');
  if (updatesOnly) for (const item of data) series.update(item);
  else series.setData(data);
  return { chart, series, clock };
}

const bar = (time: number, close: number): Bar => ({ time, open: 1, high: close + 1, low: 0, close });

describe('compiled script engine on an actual Chart', () => {
  it('keeps compiled study outputs and scale identity through native axis placement and restoration', () => {
    const compiled = compile(`version 1
study("Independent output", overlay = true)
factor = input(2, "Factor", min = 1, max = 20)
plot(close * factor, "Scaled")
`);
    registerIndicator(compiled);
    const { chart, series } = makeChart([1, 3, 5, 7].map((close, index) => bar(index * 60, close)), 190);
    const scaleId = 'overlay:compiled';
    const setting = compiled.inputs[0].key, key = compiled.plots[0].key;
    const study = chart.addIndicator(compiled.id, { [setting]: 10 }, { priceScaleId: scaleId });
    const plot = study.series(key)!, scale = plot.priceScale(), primaryScale = series.priceScale();
    const values = study.values(), data = plot.getData();
    expect(values[key]).toEqual([10, 30, 50, 70]);
    expect(data.map(point => point.close)).toEqual(values[key]);
    expect(scale).not.toBe(primaryScale);
    expect(chart.priceAxisLayout().map(slot => slot.scaleId)).toEqual(['right']);
    scale.setAutoScale(false);
    scale.setPriceRange({ min: 0, max: 100 });
    scale.setPriceFormatter(value => `C${value}`);

    expect(chart.setPriceAxisPlacement(0, scaleId, 'right')).toBe(true);
    expect(chart.priceAxisLayout()).toEqual([
      { scaleId: 'right', side: 'right', order: 0, x: 688, width: 56 },
      { scaleId, side: 'right', order: 1, x: 744, width: 56 },
    ]);
    expect(chart.exportSVG()).toContain('>C20</text>');
    expect(chart.setPriceAxisPlacement(0, scaleId, 'right', 0)).toBe(true);
    expect(chart.priceAxisLayout().map(slot => slot.scaleId)).toEqual([scaleId, 'right']);
    expect(chart.setPriceAxisPlacement(0, scaleId, 'left')).toBe(true);
    expect(chart.setPriceAxisPlacement(0, 'right', 'left', 0)).toBe(true);
    expect(chart.priceAxisLayout()).toEqual([
      { scaleId: 'right', side: 'left', order: 0, x: 56, width: 56 },
      { scaleId, side: 'left', order: 1, x: 0, width: 56 },
    ]);
    chart.setVisibleLogicalRange({ from: 0, to: 3 });
    expect(chart.indicators()[0]).toBe(study);
    expect(study.series(key)).toBe(plot);
    expect(plot.priceScale()).toBe(scale);
    expect(series.priceScale()).toBe(primaryScale);
    expect(study.values()).toBe(values);
    expect(plot.getData()).toEqual(data);
    expect(scale.priceRange()).toEqual({ min: 0, max: 100 });

    const saved = chart.getState(), layout = chart.priceAxisLayout();
    expect(saved.indicators?.[0]).toMatchObject({ instanceId: study.id, priceScaleId: scaleId, settings: { [setting]: 10 } });
    expect(saved.panes?.[0].scales?.[scaleId]?.placement).toEqual({ side: 'left', order: 1 });
    chart.setVisibleLogicalRange({ from: 1, to: 3 });
    chart.setPriceAxisPlacement(0, scaleId, 'hidden');
    expect(study.values()).toBe(values);
    expect(plot.getData()).toEqual(data);
    expect(chart.restoreState(saved).applied).toBe(true);
    const restored = chart.indicators().find(item => item.id === study.id)!;
    expect(restored.settings()[setting]).toBe(10);
    expect(restored.priceScaleId()).toBe(scaleId);
    expect(restored.series(key)?.priceScale()).toBe(scale);
    expect(series.priceScale()).toBe(primaryScale);
    expect(restored.values()[key]).toEqual([10, 30, 50, 70]);
    expect(restored.series(key)?.getData()).toEqual(data);
    expect(chart.priceAxisLayout()).toEqual(layout);
    expect(scale.priceRange()).toEqual({ min: 0, max: 100 });
    expect(scale.format(20)).toBe('C20');
    expect(chart.exportSVG()).toContain('>C20</text>');

    series.update(bar(180, 9));
    expect(restored.values()[key]).toEqual([10, 30, 50, 90]);
    expect(restored.series(key)?.getData()[3].close).toBe(90);
    expect(restored.series(key)?.priceScale()).toBe(scale);
  });

  it('uses compiled scalar outputs as native study inputs through updates and restoration', () => {
    const compiled = compile(`version 1
study("Connected output")
plot(close * 3, "Value")
`);
    registerIndicator(compiled);
    registerIndicator(SMA);
    const { chart, series } = makeChart([1, 3, 5, 7].map((close, index) => bar(index * 60, close)), 190);
    const producer = chart.addIndicator(compiled.id);
    const consumer = chart.addIndicator('sma', { length: 2, source: {
      kind: 'indicator', instanceId: producer.id, plotKey: compiled.plots[0].key,
    } });
    expect(consumer.values().ma).toEqual([null, 6, 12, 18]);
    series.update(bar(180, 9));
    expect(consumer.values().ma).toEqual([null, 6, 12, 21]);
    producer.setVisible(false);
    const saved = chart.getState();
    saved.indicators!.reverse();
    chart.restoreState(saved);
    const restored = chart.indicators().find(item => item.id === consumer.id)!;
    expect(restored.values().ma).toEqual([null, 6, 12, 21]);
    series.update(bar(240, 11));
    expect(restored.values().ma).toEqual([null, 6, 12, 21, 30]);
  });

  it('evaluates native close alerts from compiled outputs with provider confirmation', () => {
    const compiled = compile(`version 1
study("Confirmed output")
plot(close * 3, "Value")
`);
    const key = compiled.plots[0].key;
    registerIndicator({ ...compiled, alerts: [{
      id: 'confirmed', title: 'Confirmed value', frequency: 'onBarClose',
      when: context => context.values[key][context.index]! > 0,
      message: context => String(context.values[key][context.index]),
    }] });
    const { chart, series } = makeChart([bar(0, 2), bar(60, 3)], 61);
    const events: { time: number; message: string }[] = [];
    chart.on('indicator:alert', payload => events.push(payload as { time: number; message: string }));
    const indicator = chart.addIndicator(compiled.id);
    series.update(bar(60, 4), { confirmation: 'forming' }); indicator.values();
    expect(events).toEqual([]);
    series.update(bar(60, 4), { confirmation: 'confirmed' }); indicator.values();
    series.update(bar(60, 5), { confirmation: 'confirmed' }); indicator.values();
    series.update(bar(120, 6), { confirmation: 'forming' }); indicator.values();
    series.update(bar(120, 7), { confirmation: 'confirmed' }); indicator.values();
    expect(events.map(event => [event.time, event.message])).toEqual([[60, '12'], [120, '21']]);
    expect(indicator.values()[key]).toEqual([6, 15, 21]);
  });

  it('refreshes a compiled external mean on same-time ticks and provider replacement', async () => {
    const compiled = compile(`version 1
study("External rolling mean")
plot(sma(close, 2), "Mean")
`);
    const key = compiled.plots[0].key;
    let requested = [bar(0, 10), bar(60, 20), bar(120, 30)];
    const descriptor = createTier2Indicator({
      id: compiled.id, name: compiled.name, placement: compiled.placement,
      inputs: compiled.inputs, plots: compiled.plots,
      fetch: async context => {
        // Fetch the calculation's warmup before converting its output to points.
        const bars = await context.requestBars!({
          symbol: 'EXTERNAL', interval: '1m', from: 0, to: context.to, signal: context.signal,
        });
        const values = compiled.calc(bars, context.settings, {});
        return bars.map((item, index) => ({ time: item.time, values: { [key]: values[key][index] } }));
      },
    });
    registerIndicator(descriptor);
    const { chart, series } = makeChart([bar(0, 100), bar(60, 200), bar(120, 300)], 140);
    chart.setBarsProvider(async () => requested);
    const indicator = chart.addIndicator(descriptor.id);
    await vi.waitFor(() => expect(indicator.values()[key]).toEqual([null, 15, 25]));
    requested = [bar(0, 10), bar(60, 20), bar(120, 60)];
    series.update(bar(120, 301));
    await vi.waitFor(() => expect(indicator.values()[key]).toEqual([null, 15, 40]));
    chart.setBarsProvider(async () => [bar(0, 100), bar(60, 200), bar(120, 300)]);
    expect(indicator.values()[key]).toEqual([null, null, null]);
    await vi.waitFor(() => expect(indicator.values()[key]).toEqual([null, 150, 250]));
    expect(indicator.series(key)?.getData()[2].close).toBe(250);
  });

  it('runs a compiled requested expression through confirmation and provider replacement', async () => {
    const compiled = compile(`version 1
study("Managed external mean")
plot(sma(close, 2), "Mean")
`);
    const key = compiled.plots[0].key;
    let requested = {
      bars: [bar(0, 10), bar(120, 20)], availableAt: [60, 180], confirmed: [true, false],
    };
    const descriptor = createRequestedIndicator({
      id: compiled.id, name: compiled.name, placement: compiled.placement,
      inputs: compiled.inputs, plots: compiled.plots,
      request: () => ({ symbol: 'EXTERNAL', interval: '2m', from: 0, to: 300 }),
      expression: (bars, settings) => compiled.calc(bars, settings, {}),
    });
    registerIndicator(descriptor);
    const { chart } = makeChart([0, 60, 120, 180, 240, 300].map(time => bar(time, 1000 + time)), 360);
    chart.setBarsProvider({ requestBars: async () => requested.bars, requestSnapshot: async () => requested });
    const indicator = chart.addIndicator(descriptor.id);
    await vi.waitFor(() => expect(indicator.dataStatus()?.state).toBe('ready'));
    expect(indicator.values()[key]).toEqual([null, null, null, null, null, null]);
    requested = { ...requested, confirmed: [true, true] };
    chart.invalidateRequestedData();
    await vi.waitFor(() => expect(indicator.values()[key]).toEqual([null, null, null, 15, 15, 15]));
    chart.setBarsProvider({ requestBars: async () => [], requestSnapshot: async () => ({
      bars: [bar(0, 50), bar(120, 70)], availableAt: [60, 180], confirmed: [true, true],
    }) });
    await vi.waitFor(() => expect(indicator.values()[key]).toEqual([null, null, null, 60, 60, 60]));
    expect(indicator.series(key)?.getData()[5].close).toBe(60);
  });

  it('calculates a compiled expression on separate requested bars before availability alignment', () => {
    const compiled = compile(`version 1
study("External mean")
plot(sma(close, 2), "Mean")
`);
    const requested = {
      bars: [bar(0, 10), bar(120, 20), bar(240, 30)],
      availableAt: [60, 180, 300], confirmed: [true, true, true],
    };
    const observed: number[][] = [];
    const expression: RequestedExpression = bars => {
      observed.push(bars.map(item => item.close));
      return compiled.calc(bars, {}, {});
    };
    const key = compiled.plots[0].key;
    const descriptor: IndicatorDescriptor = {
      ...compiled,
      plots: [
        { key: 'carry', type: 'line', title: 'Carried mean' },
        { key: 'missing', type: 'line', title: 'New mean' },
      ],
      calcTail: undefined,
      calc: bars => {
        const times = bars.map(item => item.time);
        return {
          carry: alignRequestedExpression(times, requested, expression)[key],
          missing: alignRequestedExpression(times, requested, expression, { gaps: 'missing' })[key],
        };
      },
    };
    registerIndicator(descriptor);
    const { chart } = makeChart([0, 60, 120, 180, 240, 300].map(time => bar(time, 1000 + time)), 360);
    const indicator = chart.addIndicator(descriptor.id);
    expect(observed).toEqual([[10, 20, 30], [10, 20, 30]]);
    expect(indicator.values().carry).toEqual([null, null, null, 15, 15, 25]);
    expect(indicator.values().missing).toEqual([null, null, null, 15, null, 25]);
    expect(indicator.series('carry')?.getData()[4].close).toBe(15);
    expect(Number.isNaN(indicator.series('missing')!.getData()[4].close)).toBe(true);
  });

  it('rebuilds the compiled execution when a replacement primary has overlapping source revisions', () => {
    const descriptor = compile(`version 1
study("Source replacement")
var accumulated = 0
accumulated = accumulated + close
plot(accumulated, "Total")
`);
    registerIndicator(descriptor);
    const { chart, series } = makeChart([bar(120, 1), bar(180, 2)], 240, true);
    const indicator = chart.addIndicator(descriptor.id);
    const key = descriptor.plots[0].key;
    expect(indicator.values()[key]).toEqual([1, 3]);
    series.remove();
    const replacement = chart.addSeries('candlestick');
    replacement.update(bar(120, 10));
    replacement.update(bar(180, 20));
    replacement.update(bar(180, 30));
    expect(indicator.values()[key]).toEqual([10, 40]);
  });

  it('rebuilds persistent calculations after same-shaped history replacement and coalesced corrections', () => {
    const descriptor = compile(`version 1
study("Accumulated values")
var accumulated = 0
accumulated = accumulated + close
plot(accumulated, "Total")
`);
    registerIndicator(descriptor);
    const { chart, series } = makeChart([bar(120, 2), bar(180, 3), bar(240, 4)], 300);
    const indicator = chart.addIndicator(descriptor.id);
    const key = descriptor.plots[0].key;
    expect(indicator.values()[key]).toEqual([2, 5, 9]);
    series.setData([bar(120, 20), bar(180, 30), bar(240, 40)]);
    expect(indicator.values()[key]).toEqual([20, 50, 90]);
    series.update(bar(180, 10));
    series.update(bar(240, 8));
    expect(indicator.values()[key]).toEqual([20, 30, 38]);
  });

  it('rolls back ordinary persistent values across repeated updates to a forming bar', () => {
    const descriptor = compile(`version 1
study("Persistent tail")
var accumulated = 0
accumulated = accumulated + close
plot(accumulated, "Total")
`);
    registerIndicator(descriptor);
    const { chart, series } = makeChart([bar(120, 2), bar(180, 3)], 190);
    const indicator = chart.addIndicator(descriptor.id);
    const key = descriptor.plots[0].key;
    expect(indicator.values()[key]).toEqual([2, 5]);
    for (const close of [4, 5, 6]) {
      series.update(bar(180, close));
      expect(indicator.values()[key]).toEqual([2, 2 + close]);
    }
    series.update(bar(240, 7));
    expect(indicator.values()[key]).toEqual([2, 8, 15]);
    const fresh = makeChart([bar(120, 2), bar(180, 6), bar(240, 7)], 250);
    expect(fresh.chart.addIndicator(descriptor.id).values()[key]).toEqual(indicator.values()[key]);
  });

  it('publishes a provider-confirmed count-bar signal without a price change', () => {
    const descriptor = compile(`version 1
study("Provider confirmation", overlay = true)
if close > open
    signal("SETTLED", shape = "triangleUp", at = "below", color = lime)
plot(close, "Close")
`);
    let drawn: readonly SeriesMarker[] = [];
    const markers = descriptor.markers;
    descriptor.markers = context => { drawn = markers?.(context) ?? []; return drawn; };
    registerIndicator(descriptor);
    const { chart, series } = makeChart([bar(120, 2), bar(180, 3)], 10000);
    chart.setDataContext({ symbol: 'SAMPLE', interval: '100t' });
    series.setData([bar(120, 2), bar(180, 3)], { confirmation: 'forming' });
    const indicator = chart.addIndicator(descriptor.id);
    expect(drawn.map(marker => marker.time)).toEqual([120]);
    series.update(bar(180, 3), { confirmation: 'confirmed' });
    indicator.values();
    expect(drawn.map(marker => marker.time)).toEqual([120, 180]);
    series.update(bar(180, 3));
    indicator.values();
    expect(drawn.map(marker => marker.time)).toEqual([120, 180]);
  });

  it('passes historical and replay provenance and replay confirmation through the existing adapter', () => {
    const descriptor = compile(`version 1
study("Execution state")
plot(bar.isRealtime ? 1 : 0, "Live")
plot(bar.isConfirmed ? 1 : 0, "Confirmed")
`);
    registerIndicator(descriptor);
    const data = [bar(120, 2), bar(180, 3), bar(240, 4)];
    const { chart, series } = makeChart(data, 10000);
    const indicator = chart.addIndicator(descriptor.id);
    const liveKey = descriptor.plots.find(plot => plot.title === 'Live')!.key;
    const confirmedKey = descriptor.plots.find(plot => plot.title === 'Confirmed')!.key;
    series.update(bar(240, 5));
    expect(indicator.values()[liveKey][2]).toBe(1);
    series.setData(data);
    expect(indicator.values()[liveKey][2]).toBe(0);
    const replay = new ReplayController(chart, {
      series, bars: data, startIndex: 0,
      subBars: data.flatMap(item => [bar(item.time, 2), bar(item.time + 20, 3), bar(item.time + 40, 4)]),
    });
    try {
      expect(indicator.values()[liveKey]).toEqual([0]);
      expect(indicator.values()[confirmedKey]).toEqual([1]);
      replay.step();
      expect(indicator.values()[liveKey]).toEqual([0, 0]);
      expect(indicator.values()[confirmedKey]).toEqual([1, 0]);
      replay.step(2);
      expect(indicator.values()[confirmedKey]).toEqual([1, 1]);
      replay.stepBack(3);
      expect(indicator.values()[liveKey]).toEqual([0]);
      expect(indicator.values()[confirmedKey]).toEqual([1]);
    } finally { replay.stop(); }
    expect(indicator.values()[liveKey]).toEqual([0, 0, 0]);
  });

  it('composes a compiled calculation with native timeframe aggregation and live alignment', () => {
    const compiled = compile(`version 1
study("Requested mean")
plot(sma(close, 2), "Mean")
`);
    const descriptor: IndicatorDescriptor = {
      ...compiled,
      calcTail: undefined,
      calc: (bars, settings) => securityExpression(bars, '3m', requested =>
        compiled.calc(requested, settings, {}), { timezone: 'UTC' }),
    };
    registerIndicator(descriptor);
    const source = Array.from({ length: 9 }, (_, i) => bar(i * 60, i + 1));
    const { chart, series } = makeChart(source, 500);
    const indicator = chart.addIndicator(descriptor.id);
    const key = descriptor.plots[0].key;
    expect(indicator.values()[key]).toEqual([null, null, null, null, null, null, 4.5, 4.5, 4.5]);
    series.update(bar(480, 90));
    expect(indicator.values()[key]).toEqual([null, null, null, null, null, null, 4.5, 4.5, 4.5]);
    series.update(bar(540, 10));
    expect(indicator.values()[key]).toEqual([null, null, null, null, null, null, 4.5, 4.5, 4.5, 48]);
    expect(indicator.series(key)?.getData()[9].close).toBe(48);
  });

  it('preserves arithmetic and seconds-to-milliseconds conversion through the adapter', () => {
    const descriptor = compile(`version 1
study("Boundary")
plot(close * 2 + open, "Value")
plot(time, "Time")
`);
    registerIndicator(descriptor);
    const { chart } = makeChart([bar(120, 2), bar(180, 3)], 240);
    const indicator = chart.addIndicator(descriptor.id);
    const value = descriptor.plots.find(plot => plot.title === 'Value')!;
    const time = descriptor.plots.find(plot => plot.title === 'Time')!;
    expect(indicator.values()[value.key]).toEqual([5, 7]);
    expect(indicator.values()[time.key]).toEqual([120000, 180000]);
    expect(indicator.series(value.key)?.getData().map(point => point.close)).toEqual([5, 7]);
  });

  it('publishes a deferred signal at the minute close after a weekend gap', () => {
    const descriptor = compile(`version 1
study("Settled signals", overlay = true)
if close > open
    signal("UP", shape = "triangleUp", at = "below", color = lime)
plot(close, "Close")
`);
    const friday = Date.parse('2026-09-18T09:59:00Z') / 1000;
    const monday = Date.parse('2026-09-21T03:45:00Z') / 1000;
    let drawn: readonly SeriesMarker[] = [];
    const markers = descriptor.markers;
    descriptor.markers = context => { drawn = markers?.(context) ?? []; return drawn; };
    registerIndicator(descriptor);
    const { chart, series, clock } = makeChart([bar(friday, 2), bar(monday, 3)], monday + 59);
    const indicator = chart.addIndicator(descriptor.id);
    expect(drawn.map(marker => marker.time)).toEqual([friday]);
    clock.now = monday + 60;
    series.update(bar(monday, 4));
    indicator.values();
    expect(drawn.map(marker => marker.time)).toEqual([friday, monday]);
    expect(drawn[1].text).toBe('UP');
    series.update(bar(monday, 5));
    indicator.values();
    expect(drawn.map(marker => marker.time)).toEqual([friday, monday]);
  });

  it('keeps tail updates equal to a fresh execution and isolates settings between instances', () => {
    const descriptor = compile(`version 1
study("Scaled")
factor = input(2, "Factor", min = 1, max = 10)
plot(close * factor, "Scaled")
`);
    registerIndicator(descriptor);
    const { chart, series, clock } = makeChart([bar(120, 2), bar(180, 3)], 240);
    const first = chart.addIndicator(descriptor.id);
    const second = chart.addIndicator(descriptor.id);
    const key = descriptor.plots[0].key;
    const setting = descriptor.inputs[0].key;
    first.setSettings({ [setting]: 3 });
    expect(first.values()[key]).toEqual([6, 9]);
    expect(second.values()[key]).toEqual([4, 6]);
    clock.now = 300;
    series.update(bar(240, 4));
    series.update(bar(240, 5));
    expect(first.values()[key]).toEqual([6, 9, 15]);
    expect(second.values()[key]).toEqual([4, 6, 10]);
    const fresh = makeChart([bar(120, 2), bar(180, 3), bar(240, 5)], 300);
    expect(fresh.chart.addIndicator(descriptor.id).values()[key]).toEqual(second.values()[key]);
    first.remove();
    series.update(bar(240, 6));
    expect(second.values()[key]).toEqual([4, 6, 12]);
  });

  it('updates a declared table on the chart and removes its resources with the study', () => {
    const descriptor = compile(`version 1
study("Panel", overlay = true)
panel = table("Panel", 1, 1, position = "topLeft")
cell(panel, 0, 0, text(close, 2))
plot(close, "Close")
`);
    registerIndicator(descriptor);
    const { chart, series } = makeChart([bar(120, 2), bar(180, 3)], 240);
    const indicator = chart.addIndicator(descriptor.id);
    const tables = () => chart.panes().flatMap(pane => pane.primitives()).filter(p => p instanceof ChartTable);
    expect(tables()).toHaveLength(1);
    expect(tables()[0].rows()[0][0].text).toBe('3.00');
    series.update(bar(180, 5));
    indicator.values();
    expect(tables()[0].rows()[0][0].text).toBe('5.00');
    indicator.remove();
    expect(tables()).toHaveLength(0);
  });
});
