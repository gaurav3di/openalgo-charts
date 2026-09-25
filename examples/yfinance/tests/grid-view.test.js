import { describe, it, expect } from 'vitest';
import { DataLoadingController } from '/dist/openalgo-charts.mjs';
import { parseWorkspaceDocument } from '/dist/openalgo-charts.workspace.mjs';
import {
  GRID_HANDOFF_KEY, GRID_INTERVALS, GRID_PRESET_LABELS, gridFeed, gridViewRefusal, presetGlyph, handOffToGrid, takeGridHandoff, readGridFile, gridDocument,
} from '../src/grid-view.js';
import { needsGridView, validateReferenceWorkspace } from '../src/workspace-document.js';
import { gridFileDocument } from '../src/workspaces.js';

const pane = (id, symbol) => ({
  id, symbol, exchange: '', interval: '1d', chartType: 'candlestick', chart: { version: 1 }, settings: {},
  volume: true, magnet: 'off', stay: false, comparisons: [], comparisonMode: 'percent',
});
function payload(rows, columns) {
  const panes = Array.from({ length: rows * columns }, (_, i) => pane(`p${i}`, ['AAPL', 'MSFT', 'TSLA', 'NVDA'][i]));
  return { panes, activePaneId: 'p0', sync: { crosshair: true, viewport: true, symbol: false, interval: false },
    layout: { rows, columns, slots: panes.map((p, i) => ({ paneId: p.id, row: Math.floor(i / columns), column: i % columns, rowSpan: 1, columnSpan: 1 })) } };
}
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

describe('grid view feed', () => {
  it('asks the history endpoint for each widget interval by the period the source serves', async () => {
    const asked = [];
    const feed = gridFeed({ getBars: async req => { asked.push(req); return []; } });
    const signal = new AbortController().signal;
    for (const interval of GRID_INTERVALS) await feed.getBars({ symbol: 'AAPL', exchange: '', interval, from: 0, to: 1, signal });
    expect(asked.map(req => [req.interval, req.period])).toEqual([
      ['1m', '5d'], ['5m', '1mo'], ['15m', '1mo'], ['1h', '6mo'], ['1d', '2y'], ['1wk', '10y'],
    ]);
    expect(asked.every(req => req.signal === signal && req.symbol === 'AAPL')).toBe(true);
  });

  it('tells history paging there is nothing older, so a left edge downloads nothing again', async () => {
    const asked = [];
    const bars = Array.from({ length: 50 }, (_, i) => ({ time: 1_700_000_000 + i * 86400, open: 1, high: 2, low: 0.5, close: 1.5 }));
    const feed = gridFeed({ getBars: async req => { asked.push(req.period); return bars.map(bar => ({ ...bar })); } });
    const controller = new DataLoadingController(feed);
    await controller.load({ symbol: 'AAPL', exchange: '', interval: '1d', from: 1_700_000_000, to: 1_705_000_000 });
    for (let i = 0; i < 3; i++) await controller.loadMore();
    expect(asked).toEqual(['2y']);
    expect(controller.getState()).toMatchObject({ hasMore: false, historyStatus: 'exhausted' });
    controller.destroy();
  });

  it('holds requests until the hand-off is applied, and drops the ones cancelled meanwhile', async () => {
    const asked = [];
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const feed = gridFeed({ getBars: async req => { asked.push(req.symbol); return []; } }, { ready });
    const replaced = new AbortController();
    const first = feed.getBars({ symbol: 'OLD', exchange: '', interval: '1d', signal: replaced.signal });
    const second = feed.getBars({ symbol: 'NEW', exchange: '', interval: '1d', signal: new AbortController().signal });
    await Promise.resolve();
    expect(asked).toEqual([]);
    replaced.abort();
    release();
    await expect(first).rejects.toMatchObject({ name: 'AbortedError' });
    await second;
    expect(asked).toEqual(['NEW']);
  });
});

describe('grid view documents', () => {
  it('tells the main page which valid layouts only the grid view can show', () => {
    expect(needsGridView(payload(2, 2))).toBe(true);
    expect(needsGridView(payload(1, 3))).toBe(true);
    expect(needsGridView(payload(2, 1))).toBe(true);
    expect(needsGridView(payload(1, 2))).toBe(false);
    expect(needsGridView(payload(1, 1))).toBe(false);
    expect(needsGridView({ layout: 1 })).toBe(false);
    expect(() => validateReferenceWorkspace(payload(2, 2))).toThrow(/grid view/);
    expect(gridFileDocument(JSON.stringify(payload(2, 2)))).toMatchObject({ layout: { rows: 2, columns: 2 } });
    expect(gridFileDocument(JSON.stringify(payload(1, 2)))).toBeNull();
    expect(gridFileDocument('{not json')).toBeNull();
  });

  it('hands a layout to the grid view once and survives a refusing store', () => {
    const storage = new MemoryStorage();
    expect(handOffToGrid(payload(2, 2), storage)).toBe(true);
    expect(JSON.parse(storage.getItem(GRID_HANDOFF_KEY)).layout.rows).toBe(2);
    const text = takeGridHandoff(storage);
    expect(readGridFile(text).panes).toHaveLength(4);
    expect(takeGridHandoff(storage)).toBeNull();
    const refusing = { setItem() { throw new Error('quota'); }, getItem() { throw new Error('blocked'); }, removeItem() {} };
    expect(handOffToGrid(payload(2, 2), refusing)).toBe(false);
    expect(takeGridHandoff(refusing)).toBeNull();
  });

  it('names what the grid view cannot open before the main page hands it over', () => {
    expect(gridViewRefusal(payload(2, 2))).toBe('');
    const compared = payload(2, 2);
    compared.panes[1].comparisons = [{ id: 'c', symbol: 'QQQ', exchange: '', visible: true }];
    expect(gridViewRefusal(compared)).toMatch(/MSFT: comparison symbols/);
    const monthly = payload(2, 2);
    monthly.panes[2].interval = '1mo';
    expect(gridViewRefusal(monthly)).toMatch(/TSLA: the grid view has no 1mo interval/);
    const weekly = payload(2, 2);
    for (const pane of weekly.panes) pane.interval = '1wk';
    weekly.sync.interval = true;
    expect(gridViewRefusal(weekly)).toBe('');
    expect(readGridFile(JSON.stringify(weekly)).panes.map(pane => pane.interval)).toEqual(['1w', '1w', '1w', '1w']);
    const linked = payload(2, 2);
    linked.sync.symbol = true;
    expect(gridViewRefusal(linked)).toMatch(/linked by symbol/);
    expect(() => readGridFile(JSON.stringify(monthly))).toThrow(/1mo/);
  });

  it('reads complete documents and bare payloads, and refuses malformed files before any chart changes', () => {
    const document = gridDocument(payload(2, 2), { name: 'Desk', now: 5 });
    expect(document).toMatchObject({ kind: 'workspace', version: 1, id: 'grid-5', name: 'Desk', createdAt: 5 });
    expect(parseWorkspaceDocument(JSON.stringify(document)).layout.rows).toBe(2);
    expect(readGridFile(JSON.stringify(document)).panes).toHaveLength(4);
    expect(readGridFile(JSON.stringify(payload(1, 3))).layout.columns).toBe(3);
    expect(() => readGridFile('{"panes":[]}')).toThrow();
    expect(() => gridDocument({ ...payload(1, 1), activePaneId: 'missing' })).toThrow();
  });

  it('draws one box per chart in each preset glyph, with a label for every preset', () => {
    expect(presetGlyph('2x2').match(/<rect /g)).toHaveLength(4);
    expect(presetGlyph('1x3').match(/<rect /g)).toHaveLength(3);
    expect(Object.keys(GRID_PRESET_LABELS)).toEqual(['1x1', '1x2', '1x3', '2x1', '3x1', '2x2']);
  });
});
