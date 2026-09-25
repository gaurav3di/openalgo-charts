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
/** SHA-256 of the JSON form, through the platform digest so the suite needs no runtime typings. */
const digest = async (value: unknown): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
};

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
  it('keep one drawing layer and one marker layer, bound and painted exactly as before', async () => {
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
    expect(await digest(paneLayers.map(layer => layer.ops))).toBe('53bd135f90d67b4e86db39afd7837a05d8c2bc94d5308f2ccbc712af31fbd07d');
    expect(await digest(priceLayers.map(layer => layer.ops))).toBe('25f04af979b9d3e88e7b1a818355bb0671666a039180df3eedaeacfb705a9eb8');
  });
});

type Route = 'study' | 'price' | 'alt' | 'guide';
const ROUTES = (['study', 'price', 'alt', 'guide'] as const).map(value => ({ label: value, value }));
/** Where a routed output goes: nowhere special, the price pane, or a named plot. */
const target = (route: Route): { overlay?: boolean; plot?: string } =>
  route === 'price' ? { overlay: true } : route === 'study' ? {} : { plot: route };

/** A local oscillator, a second local plot for another axis, and a guide on the candles. */
const PLOTS: IndicatorDescriptor['plots'] = [
  { key: 'osc', type: 'line', title: 'Osc' },
  { key: 'alt', type: 'line', title: 'Alt' },
  { key: 'guide', type: 'line', title: 'Guide', overlay: true },
];
const CALC: IndicatorDescriptor['calc'] = bars => ({
  osc: bars.map((_, i) => 30 + i), alt: bars.map((_, i) => 500 + i), guide: bars.map(bar => bar.close),
});

let seq = 0;
function routedDraws(): string {
  const id = `targets-draws-${seq++}`;
  registerIndicator({
    id, name: 'Routed drawings', placement: 'pane', plots: PLOTS, calc: CALC,
    inputs: [{ key: 'zone', type: 'select', label: 'Zone', default: 'price', options: ROUTES }],
    draws: ({ bars, settings }) => {
      const route = settings.zone as Route;
      const [lo, hi] = route === 'alt' ? [510, 520] : route === 'study' ? [40, 50] : [112, 124];
      return [
        { kind: 'line', from: { time: bars[2].time, price: 32 }, to: { time: bars[30].time, price: 60 }, id: 'ray' } as never,
        { kind: 'box', from: { time: bars[10].time, price: hi }, to: { time: bars[20].time, price: lo },
          fillColor: '#26a69a', id: 'zone', ...target(route) } as never,
      ];
    },
  });
  return id;
}

const owned = (study: IndicatorApi): { primitive: IPrimitive; overlay: boolean }[] =>
  (study as unknown as { renderResources(): { primitives: { primitive: IPrimitive; overlay: boolean }[] } }).renderResources().primitives;
const drawingObjects = (study: IndicatorApi): IPrimitive[] =>
  owned(study).filter(({ primitive }) => primitive instanceof IndicatorDrawings).map(({ primitive }) => primitive);
/** The study's drawing layers: pane, binding, placement role and which shapes each holds. */
function drawLayers(chart: Chart, study: IndicatorApi): { pane: number; scale: string | null; overlay: boolean; ids: (string | undefined)[] }[] {
  return owned(study).filter(({ primitive }) => primitive instanceof IndicatorDrawings).map(({ primitive, overlay }) => {
    const pane = paneOf(chart, primitive);
    return {
      pane, scale: chart.panes()[pane]?.primitiveScaleId(primitive) ?? null, overlay,
      ids: (primitive as unknown as { _items: { id?: string }[] })._items.map(item => item.id),
    };
  });
}
const drawingsOn = (chart: Chart, paneIndex: number): IPrimitive[] =>
  layers(chart.panes()[paneIndex], IndicatorDrawings) as unknown as IPrimitive[];
const allDrawings = (chart: Chart): number => chart.panes().reduce((sum, _, i) => sum + drawingsOn(chart, i).length, 0);
const click = (el: FakeElement, x: number, y: number): void => {
  el.dispatch('pointerdown', pointer('down', x, y));
  el.dispatch('pointerup', pointer('up', x, y));
};
const paneTop = (chart: Chart, paneIndex: number): number => (chart as unknown as ChartInternals)._paneLayout()[paneIndex].top;

describe('drawing targets', () => {
  it('sends a price-pane drawing to pane zero on its right scale and keeps the rest in the study pane', () => {
    const { chart } = mount();
    const study = chart.addIndicator(routedDraws());
    expect(drawLayers(chart, study)).toEqual([
      { pane: 1, scale: 'right', overlay: false, ids: ['ray'] },
      { pane: 0, scale: 'right', overlay: true, ids: ['zone'] },
    ]);
  });

  it('binds a plot target to that plot pane and effective scale, beside differently bound layers', () => {
    const id = routedDraws();
    const { chart } = mount();
    const alt = chart.addIndicator(id, { zone: 'alt' }, { plotPriceScaleIds: { alt: 'left' } });
    const guide = chart.addIndicator(id, { zone: 'guide' }, { plotPriceScaleIds: { guide: 'overlay:guide' } });
    expect(drawLayers(chart, alt)).toEqual([
      { pane: alt.paneIndex, scale: 'right', overlay: false, ids: ['ray'] },
      { pane: alt.paneIndex, scale: 'left', overlay: false, ids: ['zone'] },
    ]);
    expect(drawLayers(chart, guide)).toEqual([
      { pane: guide.paneIndex, scale: 'right', overlay: false, ids: ['ray'] },
      { pane: 0, scale: 'overlay:guide', overlay: true, ids: ['zone'] },
    ]);
  });

  it('follows plot and whole-study scale reassignment without moving price-pane layers', () => {
    const id = routedDraws();
    const { chart } = mount();
    const study = chart.addIndicator(id, { zone: 'alt' });
    const guide = chart.addIndicator(id, { zone: 'guide' });
    const bound = (item: IndicatorApi) => drawLayers(chart, item).map(layer => `${layer.pane}:${layer.scale}`);
    expect(study.setPlotPriceScales({ alt: 'overlay:alt' })).toBe(true);
    expect(bound(study)).toEqual([`${study.paneIndex}:right`, `${study.paneIndex}:overlay:alt`]);
    expect(study.setPlotPriceScales({ alt: null })).toBe(true);
    expect(bound(study)).toEqual([`${study.paneIndex}:right`, `${study.paneIndex}:right`]);
    expect(study.setPriceScale('left')).toBe(true);
    expect(bound(study)).toEqual([`${study.paneIndex}:left`, `${study.paneIndex}:left`]);
    expect(guide.setPriceScale('left')).toBe(true);
    expect(bound(guide)).toEqual([`${guide.paneIndex}:left`, '0:right']);
    study.setSettings({ zone: 'price' });
    expect(bound(study)).toEqual([`${study.paneIndex}:left`, '0:right']);
    expect(study.setPriceScale(null)).toBe(true);
    expect(bound(study)).toEqual([`${study.paneIndex}:right`, '0:right']);
  });

  it('moves a shape between targets when settings change and releases the layer it left', () => {
    const { chart } = mount();
    const study = chart.addIndicator(routedDraws());
    const [local] = drawingObjects(study);
    study.setSettings({ zone: 'alt' });
    expect(drawLayers(chart, study)).toEqual([
      { pane: 1, scale: 'right', overlay: false, ids: ['ray'] },
      { pane: 1, scale: 'right', overlay: false, ids: ['zone'] },
    ]);
    expect(drawingsOn(chart, 0)).toHaveLength(0);
    study.setSettings({ zone: 'study' });
    expect(drawLayers(chart, study)).toEqual([{ pane: 1, scale: 'right', overlay: false, ids: ['ray', 'zone'] }]);
    expect(drawingObjects(study)).toEqual([local]);
    expect(allDrawings(chart)).toBe(1);
  });

  it('hides and shows every target layer with the study', () => {
    const { chart } = mount();
    const study = chart.addIndicator(routedDraws(), { zone: 'price' });
    const painted = () => ownedLayers(chart, study).filter(layer => layer.kind === 'IndicatorDrawings').map(layer => layer.ops.length > 0);
    expect(painted()).toEqual([true, true]);
    study.setVisible(false);
    expect(painted()).toEqual([false, false]);
    study.setVisible(true);
    expect(painted()).toEqual([true, true]);
  });

  it('keeps price-pane layers on pane zero through moves and releases them with the study or its pane', () => {
    const id = routedDraws();
    const { chart } = mount();
    const study = chart.addIndicator(id, { zone: 'price' });
    const other = chart.addIndicator(id, { zone: 'alt' });
    expect(chart.moveIndicator(other.id, chart.panes().length)).toBe(true);
    expect(drawLayers(chart, other).map(layer => layer.pane)).toEqual([other.paneIndex, other.paneIndex]);
    expect(chart.moveIndicator(study.id, other.paneIndex)).toBe(true);
    expect(drawLayers(chart, study).map(layer => layer.pane)).toEqual([other.paneIndex, 0]);
    expect(drawingsOn(chart, 0)).toHaveLength(1);
    const removable = chart.addIndicator(id, { zone: 'price' });
    expect(drawingsOn(chart, 0)).toHaveLength(2);
    expect(chart.removePane(removable.paneIndex)).toBe(true);
    expect(drawingsOn(chart, 0)).toHaveLength(1);
    study.remove();
    expect(drawingsOn(chart, 0)).toHaveLength(0);
    other.remove();
    expect(allDrawings(chart)).toBe(0);
  });

  it('reports clicks on a routed box where it is drawn: on pane zero and on its plot scale', () => {
    const { chart, el } = mount();
    const clicks: string[] = [];
    chart.subscribeClick(id => { clicks.push(id); });
    const study = chart.addIndicator(routedDraws(), { zone: 'price' });
    click(el, chart.timeToCoordinate(BARS[15].time), chart.priceToCoordinate(118, 0)!);
    expect(clicks).toEqual(['zone']);
    study.setSettings({ zone: 'alt' });
    expect(study.setPlotPriceScales({ alt: 'left' })).toBe(true);
    const y = paneTop(chart, study.paneIndex) + chart.panes()[study.paneIndex].scaleFor('left').priceToY(515);
    click(el, chart.timeToCoordinate(BARS[15].time), y);
    expect(clicks).toEqual(['zone', 'zone']);
  });

  it('restores routed layers from saved state with their bindings', () => {
    const id = routedDraws();
    const { chart } = mount();
    chart.addIndicator(id, { zone: 'price' });
    chart.addIndicator(id, { zone: 'alt' }, { plotPriceScaleIds: { alt: 'left' } });
    const state = JSON.parse(JSON.stringify(chart.getState()));
    expect(chart.restoreState(state)).toMatchObject({ applied: true, indicators: 2 });
    const [price, alt] = chart.indicators();
    expect(drawLayers(chart, price)).toEqual([
      { pane: price.paneIndex, scale: 'right', overlay: false, ids: ['ray'] },
      { pane: 0, scale: 'right', overlay: true, ids: ['zone'] },
    ]);
    expect(drawLayers(chart, alt)).toEqual([
      { pane: alt.paneIndex, scale: 'right', overlay: false, ids: ['ray'] },
      { pane: alt.paneIndex, scale: 'left', overlay: false, ids: ['zone'] },
    ]);
    expect(allDrawings(chart)).toBe(4);
  });

  it('gives each instance and each target a layer of its own', () => {
    const id = routedDraws();
    const { chart } = mount();
    const first = chart.addIndicator(id, { zone: 'price' });
    const second = chart.addIndicator(id, { zone: 'price' });
    const kept = drawingObjects(second);
    expect(drawingsOn(chart, 0)).toHaveLength(2);
    first.setSettings({ zone: 'study' });
    expect(drawingsOn(chart, 0)).toEqual([kept[1]]);
    first.remove();
    expect(drawingObjects(second)).toEqual(kept);
    expect(drawLayers(chart, second).map(layer => layer.ids)).toEqual([['ray'], ['zone']]);
  });

  it.each([{ plot: 'missing' }, { plot: 'alt', overlay: true }])('rejects the target %j before changing any layer', bad => {
    const id = `targets-invalid-draws-${seq++}`;
    registerIndicator({
      id, name: 'Invalid', placement: 'pane', plots: PLOTS, calc: CALC,
      inputs: [{ key: 'bad', type: 'boolean', label: 'Bad', default: true }],
      draws: ({ bars, settings }) => [{ kind: 'line', from: { time: bars[1].time, price: 110 }, to: { time: bars[9].time, price: 120 },
        ...(settings.bad === true ? bad : { overlay: true }) } as never],
    });
    const { chart } = mount();
    expect(() => chart.addIndicator(id)).toThrow(/declared plot or the price pane/);
    expect(chart.panes()).toHaveLength(1);
    expect(allDrawings(chart)).toBe(0);
    const study = chart.addIndicator(id, { bad: false });
    const before = drawLayers(chart, study);
    study.setSettings({ bad: true });
    expect(study.dataStatus()?.state).toBe('error');
    expect(drawLayers(chart, study)).toEqual(before);
  });
});
