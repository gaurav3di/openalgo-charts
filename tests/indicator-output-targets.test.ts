/**
 * Explicit pane and scale targets for a study's drawings and markers.
 *
 * A study that lives in its own pane used to have one drawing layer and one
 * marker layer, both in that pane on its first plot's scale. A zone that
 * belongs on the candles, or a signal measured against a second plot on
 * another axis, had nowhere to go. A drawing or marker can now name the price
 * pane (`overlay: true`) or a declared plot (`plot: key`), and the runtime
 * keeps one owned layer per target that follows moves, scale reassignment,
 * hiding, removal and restore.
 *
 * The first block pins what a descriptor that names no target renders. Its
 * digests were recorded before targets existed, so any change to the default
 * path fails here rather than in someone's chart.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Chart } from '../src/core/chart';
import type { Pane, PaneRenderContext } from '../src/core/pane';
import { registerIndicator, type IndicatorDescriptor } from '../src/model/indicator-registry';
import type { IndicatorApi } from '../src/model/indicator-instance';
import type { Bar } from '../src/model/bar';
import type { IPrimitive, PrimitiveRenderContext } from '../src/primitives/primitive';
import { IndicatorDrawings } from '../src/primitives/indicator-draws';
import { SeriesMarkers } from '../src/primitives/markers';
import { makeCtx } from './helpers/fake-ctx';
import { fakeDocument, pointer, type FakeElement } from './helpers/fake-dom';

const T0 = 1700000000;
const BARS: Bar[] = Array.from({ length: 40 }, (_, i) => {
  const close = 120 + 10 * Math.sin(i / 5);
  return { time: T0 + i * 60, open: close - 1, high: close + 3, low: close - 3, close };
});

const charts: Chart[] = [];
beforeAll(() => { (globalThis as { window?: unknown }).window ??= {}; });
afterEach(() => { for (const chart of charts.splice(0)) chart.destroy(); });

function mount(): { chart: Chart; el: FakeElement } {
  const document = fakeDocument();
  const el = document.createElement('div') as unknown as FakeElement;
  const chart = new Chart(el, {
    document, pixelRatio: () => 1, shortcuts: false, timeNavigator: false, animZoom: false, animAutoscale: false,
    raf: { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} },
  });
  charts.push(chart);
  chart.applySize(800, 600);
  chart.addSeries('candlestick').setData(BARS);
  return { chart, el };
}

interface ChartInternals {
  _renderContext(showTimeAxis: boolean): PaneRenderContext;
  _bottomPaneIndex(): number;
  _paneLayout(): { top: number; height: number }[];
}
interface PaneInternals {
  _primitiveContext(ctx: PaneRenderContext): PrimitiveRenderContext;
  _boundPrimitiveContext(p: IPrimitive, context: PrimitiveRenderContext, ctx: PaneRenderContext): PrimitiveRenderContext;
}

/** Paint one primitive the way its pane would, into a recorder, and return the ops. */
function paint(chart: Chart, paneIndex: number, primitive: IPrimitive): unknown[] {
  const internals = chart as unknown as ChartInternals;
  const pane = chart.panes()[paneIndex] as unknown as PaneInternals;
  const ctx = internals._renderContext(paneIndex === internals._bottomPaneIndex());
  const rc = pane._boundPrimitiveContext(primitive, pane._primitiveContext(ctx), ctx);
  const { ctx: canvas, rec } = makeCtx();
  primitive.draw?.(canvas, rc);
  return rec.ops;
}

const paneOf = (chart: Chart, primitive: IPrimitive): number => chart.panes().findIndex(pane => pane.hasPrimitive(primitive));
const layers = <T>(pane: Pane, type: new (...args: never[]) => T): T[] =>
  pane.primitives().filter((p): p is T & IPrimitive => p instanceof type) as T[];
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Every study-owned drawing and marker layer: its pane, its binding and what it paints. */
function ownedLayers(chart: Chart, study: IndicatorApi): { kind: string; pane: number; scale: string | null; overlay: boolean; ops: unknown[] }[] {
  const resources = (study as unknown as { renderResources(): { primitives: { primitive: IPrimitive; overlay: boolean }[] } }).renderResources();
  return resources.primitives
    .filter(({ primitive }) => primitive instanceof IndicatorDrawings || primitive instanceof SeriesMarkers)
    .map(({ primitive, overlay }) => {
      const pane = paneOf(chart, primitive);
      return {
        kind: primitive.constructor.name, pane, overlay,
        scale: chart.panes()[pane].primitiveScaleId(primitive), ops: paint(chart, pane, primitive),
      };
    });
}

const untargetedPane: IndicatorDescriptor = {
  id: 'targets-untargeted-pane', name: 'Untargeted pane', placement: 'pane', inputs: [],
  plots: [{ key: 'osc', type: 'line', title: 'Osc' }, { key: 'alt', type: 'line', title: 'Alt' }],
  calc: bars => ({ osc: bars.map((_, i) => 30 + i), alt: bars.map((_, i) => 60 - i / 2) }),
  draws: ({ bars }) => [
    { kind: 'line', from: { time: bars[2].time, price: 32 }, to: { time: bars[30].time, price: 60 }, color: '#4f8cff', lineStyle: 'dashed' },
    { kind: 'box', from: { time: bars[10].time, price: 40 }, to: { time: bars[20].time, price: 50 }, fillColor: '#26a69a', text: 'Zone', id: 'zone' },
    { kind: 'label', at: { time: bars[25].time, price: 55 }, text: 'Two\nrows', color: '#ef5350', align: 'left' },
    { kind: 'polyline', points: [{ time: bars[5].time, price: 35 }, { time: bars[15].time, price: 45 }, { time: bars[25].time, price: 40 }], closed: true, fillColor: '#ffa726' },
  ],
  markers: ({ bars }) => [
    { time: bars[12].time, position: 'aboveBar', shape: 'arrowDown', size: 'small', color: '#ef5350', text: 'Hi' },
    { time: bars[18].time, position: 'belowBar', shape: 'labelUp', size: 'medium', color: '#26a69a', text: 'Buy', id: 'buy' },
    { time: bars[24].time, position: 'atPrice', price: 50, shape: 'circle', size: 'tiny', color: '#4f8cff' },
  ],
};

const untargetedPrice: IndicatorDescriptor = {
  id: 'targets-untargeted-price', name: 'Untargeted price', placement: 'onchart', markerAnchor: 'price', inputs: [],
  plots: [{ key: 'mid', type: 'line', title: 'Mid' }],
  calc: bars => ({ mid: bars.map(bar => (bar.open + bar.close) / 2) }),
  draws: ({ bars }) => [
    { kind: 'box', from: { time: bars[8].time, price: 125 }, to: { time: bars[16].time, price: 115 }, color: '#ef5350', text: 'Supply\n125' },
  ],
  markers: ({ bars }) => [
    { time: bars[9].time, position: 'belowBar', shape: 'labelUp', size: 'small', color: '#26a69a', text: 'Up' },
    { time: bars[21].time, position: 'aboveBar', shape: 'labelDown', size: 'small', color: '#ef5350', text: 'Down' },
  ],
};

describe('descriptors that name no target', () => {
  it('keep one drawing layer and one marker layer, bound and painted exactly as before', () => {
    registerIndicator(untargetedPane);
    registerIndicator(untargetedPrice);
    const { chart } = mount();
    const pane = chart.addIndicator(untargetedPane.id);
    const price = chart.addIndicator(untargetedPrice.id);
    const paneLayers = ownedLayers(chart, pane);
    const priceLayers = ownedLayers(chart, price);
    expect(paneLayers.map(({ ops: _ops, ...rest }) => rest)).toEqual([
      { kind: 'SeriesMarkers', pane: 1, overlay: false, scale: null },
      { kind: 'IndicatorDrawings', pane: 1, overlay: false, scale: 'right' },
    ]);
    expect(priceLayers.map(({ ops: _ops, ...rest }) => rest)).toEqual([
      { kind: 'SeriesMarkers', pane: 0, overlay: true, scale: null },
      { kind: 'IndicatorDrawings', pane: 0, overlay: false, scale: 'right' },
    ]);
    expect(paneLayers.every(layer => layer.ops.length > 0) && priceLayers.every(layer => layer.ops.length > 0)).toBe(true);
    expect(digest(paneLayers.map(layer => layer.ops))).toBe('53bd135f90d67b4e86db39afd7837a05d8c2bc94d5308f2ccbc712af31fbd07d');
    expect(digest(priceLayers.map(layer => layer.ops))).toBe('25f04af979b9d3e88e7b1a818355bb0671666a039180df3eedaeacfb705a9eb8');
  });
});
