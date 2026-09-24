import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticBag, check, emit, isError, parse, sourceFile } from 'script-engine-under-test';
import { descriptorFor } from 'script-engine-under-test/adapters/charts';
import { Chart } from '../src/core/chart';
import { registerIndicator, type IndicatorDescriptor } from '../src/model/indicator-registry';
import type { Bar } from '../src/model/bar';
import type { SeriesMarker } from '../src/primitives/markers';
import { ChartTable } from '../src/primitives/table';
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

function makeChart(data: Bar[], now: number) {
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
  series.setData(data);
  return { chart, series, clock };
}

const bar = (time: number, close: number): Bar => ({ time, open: 1, high: close + 1, low: 0, close });

describe('compiled script engine on an actual Chart', () => {
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
