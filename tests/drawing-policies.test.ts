/**
 * Drawing policies: selection, editing, persistence and the object inventory
 * restricted independently of one another and of `locked`. Each restriction
 * is checked on every path that could reach the drawing, since a policy that
 * one path honours and another ignores is not a policy.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Chart } from '../src/core/chart';
import { ChartObjects } from '../src/model/chart-objects';
import { fakeDocument } from './helpers/fake-dom';
import { darkTheme } from '../src/theme';
import {
  DrawingController, DrawingLayer, migrateDrawings, encodeClipboardPayload, cloneDrawing,
  type ClipboardPort, type Drawing, type DrawingInput,
} from '../src/draw/index';
import type { DrawingChartHost } from '../src/draw/controller';
import type { Bar } from '../src/model/bar';
import type { DataLayer } from '../src/model/data-layer';

const T0 = 1700000000;

beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= {};
});

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 5;
    return { time: T0 + i * 60, open: c, high: c + 2, low: c - 2, close: c, volume: 10 };
  });

const charts: Chart[] = [];
function makeChart(): Chart {
  const chart = new Chart(fakeDocument().createElement('div') as unknown as HTMLElement, {
    document: fakeDocument(),
    raf: { schedule: (cb: (t: number) => void) => { cb(0); return 0; } },
    pixelRatio: () => 1, shortcuts: false,
  });
  chart.applySize(800, 600);
  chart.addSeries('candlestick').setData(bars(120));
  charts.push(chart);
  return chart;
}
afterEach(() => { for (const chart of charts.splice(0)) chart.destroy(); });

/** A host with a working bus, no pixel mapping, and the last state it was handed. */
function busHost(): DrawingChartHost & { state: unknown } {
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  const host = {
    state: undefined as unknown,
    on: (event: string, handler: (p: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
    },
    emit: (event: string, payload: unknown) => { for (const h of handlers.get(event) ?? []) h(payload); },
    addPrimitive: () => {},
    removePrimitive: () => {},
    dataLayer: { baseIndex: 2, indexToTime: (i: number) => T0 + i * 300 } as unknown as DataLayer,
    getVisibleLogicalRange: () => null,
    drawingState: () => null,
    setDrawingState: (value: unknown) => { host.state = value; },
  };
  return host;
}

/** A clipboard that holds one string, the way the OS one does. */
function memoryPort(): ClipboardPort & { text: string } {
  const port = { text: '', writeText: async (t: string) => { port.text = t; }, readText: async () => port.text };
  return port;
}

const line = (draw: DrawingController, extra: Partial<DrawingInput> = {}): Drawing => draw.add({
  tool: 'trend-line', paneIndex: 0, style: {},
  points: [{ time: 1000, price: 10 }, { time: 2000, price: 20 }],
  ...extra,
});

const drag = (chart: DrawingChartHost, id: string, time: number, price: number): void =>
  chart.emit('drag', { id, time, price, paneIndex: 0 });

describe('a read-only drawing (editable: false)', () => {
  it('still selects, and every user edit leaves it exactly as it was', async () => {
    const chart = busHost();
    const draw = new DrawingController(chart, { clipboard: memoryPort() });
    const fixed = line(draw, { policy: { editable: false }, style: { color: '#123456' } });
    const before = JSON.stringify(draw.get(fixed.id));
    draw.select(fixed.id);
    expect(draw.selection()).toEqual([fixed.id]);
    expect(draw.update(fixed.id, { style: { color: '#ff0000' } })).toBe(false);
    draw.updateMany([{ id: fixed.id, patch: { visible: false, locked: true } }]);
    draw.nudge([fixed.id], 10, 10);
    expect(draw.remove(fixed.id)).toBe(false);
    draw.removeMany([fixed.id]);
    draw.clear();
    expect(await draw.cut(fixed.id)).toBe(false);
    // The body and a handle, grabbed and dragged.
    draw.select(fixed.id);
    drag(chart, `draw:${fixed.id}`, 1000, 10);
    drag(chart, `draw:${fixed.id}`, 1500, 15);
    chart.emit('drag:end', {});
    drag(chart, `draw:${fixed.id}#1`, 2500, 25);
    chart.emit('drag:end', {});
    expect(JSON.stringify(draw.get(fixed.id))).toBe(before);
    expect(draw.canUndo()).toBe(false);
  });

  it('is left alone by a multi-selection edit while the rest of the selection changes', () => {
    const chart = busHost();
    const draw = new DrawingController(chart);
    const fixed = line(draw, { policy: { editable: false } });
    const free = line(draw, { points: [{ time: 5000, price: 50 }, { time: 6000, price: 60 }] });
    draw.select([fixed.id, free.id]);
    draw.updateMany([fixed.id, free.id].map((id) => ({ id, patch: { style: { color: '#00ff00' } } })));
    expect(draw.get(fixed.id)?.style.color).toBeUndefined();
    expect(draw.get(free.id)?.style.color).toBe('#00ff00');
    drag(chart, `draw:${free.id}`, 5000, 50);
    drag(chart, `draw:${free.id}`, 5100, 51);
    chart.emit('drag:end', {});
    expect(draw.get(free.id)?.points[0]).toEqual({ time: 5100, price: 51 });
    expect(draw.get(fixed.id)?.points[0]).toEqual({ time: 1000, price: 10 });
    draw.removeMany([fixed.id, free.id]);
    expect(draw.drawings().map((d) => d.id)).toEqual([fixed.id]);
  });

  it('moves, restyles and goes when the host says force', () => {
    const draw = new DrawingController(busHost());
    const fixed = line(draw, { policy: { editable: false } });
    expect(draw.update(fixed.id, { points: [{ time: 3000, price: 30 }, { time: 4000, price: 40 }] }, { force: true })).toBe(true);
    expect(draw.get(fixed.id)?.points[0]).toEqual({ time: 3000, price: 30 });
    draw.updateMany([{ id: fixed.id, patch: { style: { color: '#abcdef' } } }], { force: true });
    expect(draw.get(fixed.id)?.style.color).toBe('#abcdef');
    expect(draw.remove(fixed.id, { force: true })).toBe(true);
    const again = line(draw, { policy: { editable: false } });
    draw.clear({ force: true });
    expect(draw.get(again.id)).toBeUndefined();
    const third = line(draw, { policy: { editable: false } });
    draw.removeMany([third.id], { force: true });
    expect(draw.drawings()).toEqual([]);
  });

  it('keeps out of the undo history, so undo neither removes, restores nor rewinds it', () => {
    const draw = new DrawingController(busHost());
    const fixed = line(draw, { policy: { editable: false } });
    // A host placing its own drawing is not a step the user can take back.
    expect(draw.canUndo()).toBe(false);
    const mine = line(draw, { points: [{ time: 5000, price: 50 }, { time: 6000, price: 60 }] });
    expect(draw.undo()).toBe(true);
    expect(draw.get(mine.id)).toBeUndefined();
    expect(draw.get(fixed.id)).toBeDefined();
    expect(draw.canRedo()).toBe(true);
    // A forced host edit neither records a step nor wipes the redo branch.
    draw.update(fixed.id, { style: { color: '#010203' } }, { force: true });
    expect(draw.canUndo()).toBe(false);
    expect(draw.canRedo()).toBe(true);
    expect(draw.redo()).toBe(true);
    expect(draw.get(mine.id)).toBeDefined();
    // A drawing made read-only after the user moved it is not moved back.
    draw.nudge([mine.id], 10, 0);
    const moved = draw.get(mine.id)?.points[0].time;
    draw.update(mine.id, { policy: { editable: false } });
    draw.undo();
    expect(draw.get(mine.id)?.points[0].time).toBe(moved);
    expect(draw.get(mine.id)?.policy?.editable).toBe(false);
    // Neither is a forced removal something undo brings back.
    draw.remove(fixed.id, { force: true });
    while (draw.undo()) { /* walk the whole history */ }
    expect(draw.get(fixed.id)).toBeUndefined();
  });

  it('stays when its group is removed with its drawings, and the removal still records', () => {
    const chart = busHost();
    const draw = new DrawingController(chart);
    const fixed = line(draw, { policy: { editable: false } });
    const free = line(draw);
    const both = draw.createGroup('Both', [fixed.id, free.id])!;
    draw.removeGroup(both.id, true);
    expect(draw.drawings().map((d) => d.id)).toEqual([fixed.id]);
    expect(draw.groups()).toEqual([]);
    // A group of read-only drawings only: nothing is deleted, the group goes,
    // and the saved state and the history both see that.
    const alone = draw.createGroup('Alone', [fixed.id])!;
    draw.removeGroup(alone.id, true);
    expect(draw.get(fixed.id)).toBeDefined();
    expect((chart.state as { groups?: unknown }).groups).toBeUndefined();
    expect(draw.undo()).toBe(true);
    expect(draw.groups().map((g) => g.name)).toEqual(['Alone']);
  });

  it('copies and duplicates into the user\'s own drawing, without the policy', async () => {
    const draw = new DrawingController(busHost(), { clipboard: memoryPort() });
    const fixed = line(draw, { policy: { editable: false, persistent: false, listed: false } });
    const [dup] = draw.duplicate([fixed.id]);
    expect(dup.policy).toBeUndefined();
    expect(draw.update(dup.id, { style: { color: '#222222' } })).toBe(true);
    expect(await draw.copy(fixed.id)).toBe(true);
    const [pasted] = await draw.paste();
    expect(pasted.policy).toBeUndefined();
    expect(encodeClipboardPayload([draw.get(fixed.id)!])).not.toContain('policy');
    expect(draw.remove(pasted.id)).toBe(true);
  });
});

describe('a drawing that cannot be selected (selectable: false)', () => {
  it('never joins the selection, whoever asks', () => {
    const chart = busHost();
    const draw = new DrawingController(chart);
    const ghost = line(draw, { policy: { selectable: false } });
    const other = line(draw);
    draw.select(ghost.id);
    expect(draw.selection()).toEqual([]);
    draw.select([ghost.id, other.id]);
    expect(draw.selection()).toEqual([other.id]);
    draw.select(ghost.id, true);
    expect(draw.selection()).toEqual([other.id]);
    // A click reported on it (the pane's hit test never reports one) reads
    // as a click on empty space: nothing is picked, the selection clears.
    chart.emit('click', { id: `draw:${ghost.id}`, time: 1, price: 1, paneIndex: 0, point: { x: 1, y: 1 } });
    expect(draw.selection()).toEqual([]);
    chart.emit('hover', { id: `draw:${ghost.id}` });
    expect(draw.hovered()).toBeNull();
    // A drag the chart reports on it moves nothing.
    drag(chart, `draw:${ghost.id}`, 1000, 10);
    drag(chart, `draw:${ghost.id}`, 1400, 14);
    chart.emit('drag:end', {});
    expect(draw.get(ghost.id)?.points[0]).toEqual({ time: 1000, price: 10 });
  });

  it('leaves the selection the moment the policy is applied', () => {
    const draw = new DrawingController(busHost());
    const a = line(draw);
    draw.select(a.id);
    draw.update(a.id, { policy: { selectable: false } });
    expect(draw.selection()).toEqual([]);
  });
});

describe('a transient drawing (persistent: false)', () => {
  it('stays out of toJSON, the chart state and a saved group, and still undoes in the session', () => {
    const chart = makeChart();
    const draw = new DrawingController(chart);
    const kept = line(draw, { points: [{ time: T0, price: 100 }, { time: T0 + 600, price: 101 }] });
    const temp = line(draw, { policy: { persistent: false }, points: [{ time: T0, price: 99 }, { time: T0 + 600, price: 98 }] });
    draw.createGroup('Both', [kept.id, temp.id]);
    const only = line(draw, { policy: { persistent: false } });
    draw.createGroup('Temporary', [only.id]);
    const doc = draw.toJSON();
    expect(doc.drawings.map((d) => d.id)).toEqual([kept.id]);
    expect(doc.groups).toEqual([{ id: expect.any(String), name: 'Both', members: [kept.id] }]);
    const state = chart.getState().drawings as { drawings: Drawing[] };
    expect(state.drawings.map((d) => d.id)).toEqual([kept.id]);
    expect(JSON.stringify(chart.getState())).not.toContain(temp.id);
    // The model still has it, and a user edit to it still undoes.
    expect(draw.get(temp.id)).toBeDefined();
    draw.update(temp.id, { style: { color: '#333333' } });
    expect(draw.undo()).toBe(true);
    expect(draw.get(temp.id)?.style.color).toBeUndefined();
    expect(draw.get(temp.id)?.policy?.persistent).toBe(false);
    // A restore replaces the transient drawings with what was saved, whether
    // the chart restores its state or the host hands the document back.
    chart.restoreState(JSON.parse(JSON.stringify(chart.getState())));
    expect(draw.drawings().map((d) => d.id)).toEqual([kept.id]);
    line(draw, { policy: { persistent: false } });
    draw.fromJSON(doc);
    expect(draw.drawings().map((d) => d.id)).toEqual([kept.id]);
    draw.destroy();
  });
});

describe('the policy as data', () => {
  it('survives a save and a restore, and the migration keeps only its known flags', () => {
    const draw = new DrawingController(busHost());
    const a = line(draw, { policy: { editable: false, listed: false } });
    const doc = JSON.parse(JSON.stringify(draw.toJSON()));
    expect(doc.drawings[0].policy).toEqual({ editable: false, listed: false });
    const restored = new DrawingController(busHost());
    restored.fromJSON(doc);
    expect(restored.get(a.id)?.policy).toEqual({ editable: false, listed: false });
    expect(restored.remove(a.id)).toBe(false);
    const migrated = migrateDrawings([{ id: 'x', tool: 'trend-line', points: [{ time: 1, price: 1 }],
      policy: { editable: 'no', selectable: false, persistent: true, extra: false, listed: 0 } }]);
    expect(migrated.drawings[0].policy).toEqual({ selectable: false, persistent: true });
    const empty = migrateDrawings([{ id: 'y', tool: 'trend-line', points: [{ time: 1, price: 1 }], policy: { junk: 1 } }]);
    expect(empty.drawings[0].policy).toBeUndefined();
  });

  it('is copied, not shared, by a clone', () => {
    const d: Drawing = { id: 'c', tool: 'trend-line', points: [{ time: 1, price: 1 }], style: {}, paneIndex: 0, zIndex: 0,
      policy: { editable: false } };
    const copy = cloneDrawing(d);
    expect(copy.policy).toEqual({ editable: false });
    expect(copy.policy).not.toBe(d.policy);
  });

  it('changes nothing for a drawing without one, or with every flag on', () => {
    const draw = new DrawingController(busHost());
    const plain = line(draw);
    const open = line(draw, { policy: { selectable: true, editable: true, persistent: true, listed: true } });
    draw.select([plain.id, open.id]);
    expect(draw.selection()).toEqual([plain.id, open.id]);
    draw.nudge([plain.id, open.id], 8, 0);
    expect(draw.get(open.id)?.points[0].time).toBe(draw.get(plain.id)?.points[0].time);
    expect(draw.toJSON().drawings.map((d) => d.id)).toEqual([plain.id, open.id]);
    expect(draw.remove(open.id)).toBe(true);
  });
});

/** Identity mapping: time is x, price is y. */
const rc = {
  timeScale: { indexToX: (i: number) => i },
  priceScale: { priceToY: (p: number) => p, format: (p: number) => String(p) },
  dataLayer: { timeToIndexFloat: (t: number) => t },
  plotWidth: 800, plotHeight: 600, priceAxisWidth: 60, dpr: 1, theme: darkTheme,
} as never;

const at = (id: string, extra: Partial<Drawing> = {}): Drawing => ({
  id, tool: 'trend-line', paneIndex: 0, zIndex: 0, style: {},
  points: [{ time: 100, price: 100 }, { time: 300, price: 300 }], ...extra,
});

describe('the pane hit test', () => {
  it('lets a click pass through an unselectable drawing to whatever lies under it', () => {
    const layer = new DrawingLayer('top');
    layer.setDrawings([at('under'), at('ghost', { zIndex: 1, policy: { selectable: false } })]);
    expect(layer.hitTest(200, 200, rc)?.externalId).toBe('draw:under');
    layer.setDrawings([at('ghost', { policy: { selectable: false } })]);
    expect(layer.hitTest(200, 200, rc)).toBeNull();
  });

  it('answers a read-only body as clickable but not draggable, and never offers its handles', () => {
    const layer = new DrawingLayer('top');
    layer.setDrawings([at('fixed', { policy: { editable: false } })]);
    layer.setSelected(['fixed']);
    const body = layer.hitTest(200, 200, rc);
    expect(body?.externalId).toBe('draw:fixed');
    expect(body?.draggable).not.toBe(true);
    // The anchor where a handle would be answers as the body.
    expect(layer.hitTest(100, 100, rc)?.externalId).toBe('draw:fixed');
    layer.setDrawings([at('free')]);
    layer.setSelected(['free']);
    expect(layer.hitTest(100, 100, rc)?.externalId).toBe('draw:free#0');
    expect(layer.hitTest(200, 200, rc)?.draggable).toBe(true);
  });
});

describe('the object inventory', () => {
  it('omits unlisted drawings, from the list and from their group', () => {
    const chart = makeChart();
    const draw = new DrawingController(chart);
    const shown = line(draw);
    const hidden = line(draw, { policy: { listed: false } });
    const alone = line(draw, { policy: { listed: false } });
    draw.createGroup('Mixed', [shown.id, hidden.id]);
    draw.createGroup('Unlisted', [alone.id]);
    const objects = new ChartObjects(chart, { drawings: draw });
    const ids = objects.list().map((row) => row.id);
    expect(ids).toContain('drawing:' + shown.id);
    expect(ids).not.toContain('drawing:' + hidden.id);
    expect(ids).not.toContain('drawing:' + alone.id);
    expect(objects.list().filter((row) => row.kind === 'group').map((row) => row.name)).toEqual(['Mixed']);
    // A group action reaches only the members the inventory shows.
    const group = objects.list().find((row) => row.kind === 'group')!;
    expect(objects.setVisible(group.id, false)).toBe(true);
    expect(draw.get(shown.id)?.visible).toBe(false);
    expect(draw.get(hidden.id)?.visible).not.toBe(false);
    objects.destroy();
    draw.destroy();
  });

  it('offers a read-only drawing no hide, lock or remove, and an unselectable one no select', () => {
    const chart = makeChart();
    const draw = new DrawingController(chart);
    const fixed = line(draw, { policy: { editable: false } });
    const ghost = line(draw, { policy: { selectable: false } });
    const free = line(draw);
    draw.createGroup('With a fixed member', [fixed.id, free.id]);
    const objects = new ChartObjects(chart, { drawings: draw, onSettings: () => {} });
    const row = objects.get('drawing:' + fixed.id)!;
    expect(row.capabilities).toMatchObject({ select: true, visibility: false, lock: false, remove: false, settings: true });
    expect(objects.remove(row.id)).toBe(false);
    expect(objects.setVisible(row.id, false)).toBe(false);
    expect(draw.get(fixed.id)).toBeDefined();
    expect(objects.get('drawing:' + ghost.id)?.capabilities.select).toBe(false);
    expect(objects.select('drawing:' + ghost.id)).toBe(false);
    const group = objects.list().find((item) => item.kind === 'group')!;
    expect(group.capabilities).toMatchObject({ visibility: false, lock: false, remove: false });
    objects.destroy();
    draw.destroy();
  });
});
