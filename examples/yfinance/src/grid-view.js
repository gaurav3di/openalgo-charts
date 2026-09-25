// The grid view's pieces that need no page: the feed adapter, the hand-off
// from the main page and the exported document. grid.js boots the page from
// them, and they stay importable by the node tests without a document.
import { parseWorkspaceDocument, parseWorkspacePayload } from '/dist/openalgo-charts.workspace.mjs';
import { CHART_GRID_PRESETS } from '/dist/openalgo-charts.widget.mjs';
import { YFinanceDataFeed } from './feed.js';

/** Interval pills in each grid chart: widget codes this server can answer. */
export const GRID_INTERVALS = ['1m', '5m', '15m', '1h', '1d', '1w'];

/** What each preset button says, in the order the toolbar shows them. */
export const GRID_PRESET_LABELS = {
  '1x1': 'Single chart', '1x2': 'Two columns', '1x3': 'Three columns',
  '2x1': 'Two rows', '3x1': 'Three rows', '2x2': 'Two by two',
};

/** Where the main page leaves a layout it cannot show, for this page to open. */
export const GRID_HANDOFF_KEY = 'oac-grid-handoff';

const WIRE = { '1w': '1wk' };
// The widget asks for a time window; this server answers by named period, so
// each interval asks for the longest period the source serves at it.
const PERIODS = { '1m': '5d', '5m': '1mo', '15m': '1mo', '1h': '6mo', '1d': '2y', '1w': '10y' };

/** A widget DataFeed over the page's /api/history, keeping the caller's cancellation. */
export function gridFeed(source = new YFinanceDataFeed()) {
  return {
    getBars: req => source.getBars({
      symbol: req.symbol, interval: WIRE[req.interval] || req.interval, period: PERIODS[req.interval] || '1y', signal: req.signal,
    }),
  };
}

/** A small layout glyph: one outlined box per chart. */
export function presetGlyph(preset) {
  const [rows, cols] = CHART_GRID_PRESETS[preset];
  const w = (14 - (cols - 1) * 2) / cols, h = (14 - (rows - 1) * 2) / rows;
  let boxes = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    boxes += `<rect x="${1 + c * (w + 2)}" y="${1 + r * (h + 2)}" width="${w}" height="${h}" rx="1.5"/>`;
  }
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">${boxes}</svg>`;
}

/** Leave a validated document for the grid view. False when storage refuses it. */
export function handOffToGrid(document, storage = globalThis.sessionStorage) {
  try { storage.setItem(GRID_HANDOFF_KEY, JSON.stringify(document)); return true; }
  catch { return false; }
}

/** Take the document the main page left, once. Null when there is none. */
export function takeGridHandoff(storage = globalThis.sessionStorage) {
  try {
    const text = storage.getItem(GRID_HANDOFF_KEY);
    storage.removeItem(GRID_HANDOFF_KEY);
    return text;
  } catch { return null; }
}

/** Validate any saved layout file, complete document or bare payload, before a chart changes. */
export const readGridFile = text => parseWorkspacePayload(text);

/** The grid's payload as a named document the workspace tier accepts. */
export function gridDocument(payload, { name = 'Chart grid', now = Date.now() } = {}) {
  return parseWorkspaceDocument({ kind: 'workspace', version: 1, id: `grid-${now}`, name, createdAt: now, updatedAt: now, ...payload });
}
