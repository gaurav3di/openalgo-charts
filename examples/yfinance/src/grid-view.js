// The grid view's pieces that need no page: the feed adapter, the hand-off
// from the main page and the exported document. grid.js boots the page from
// them, and they stay importable by the node tests without a document.
import { parseWorkspaceDocument, parseWorkspacePayload } from '/dist/openalgo-charts.workspace.mjs';
import { CHART_GRID_PRESETS } from '/dist/openalgo-charts.widget.mjs';
import { YFinanceDataFeed, AbortedError } from './feed.js';

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
// each interval asks for one fixed period, and the keys are every interval
// this view can load at all.
const PERIODS = { '1m': '5d', '5m': '1mo', '15m': '1mo', '30m': '1mo', '1h': '6mo', '1d': '2y', '1w': '10y' };
// The main page saves its weekly frame by the source's own code.
const ALIASES = { '1wk': '1w' };

/**
 * A widget DataFeed over the page's /api/history, keeping the caller's
 * cancellation. Requests wait for `ready` when one is given: a request
 * cancelled meanwhile never reaches the source.
 */
export function gridFeed(source = new YFinanceDataFeed(), { ready } = {}) {
  return {
    getBars: async req => {
      await ready;
      if (req.signal?.aborted) throw new AbortedError();
      return source.getBars({
        symbol: req.symbol, interval: WIRE[req.interval] || req.interval, period: PERIODS[req.interval] || '1y', signal: req.signal,
      });
    },
    // The first answer already holds the whole period this view asks for, so
    // there is no older page. Saying so stops history paging from downloading
    // the same period again at every left edge.
    getBarsPage: async () => ({ bars: [], hasMore: false }),
  };
}

/**
 * Why the grid view cannot open a layout, or '' when it can. The main page
 * asks before it leaves, so a refusal is shown where the file was chosen.
 */
export function gridViewRefusal(payload) {
  const interval = pane => ALIASES[pane.interval] || pane.interval;
  const differ = key => new Set(payload.panes.map(key)).size > 1;
  for (const pane of payload.panes) {
    if (pane.comparisons?.length) return `${pane.symbol}: comparison symbols are not drawn in the grid view`;
    if (!(interval(pane) in PERIODS)) return `${pane.symbol}: the grid view has no ${pane.interval} interval`;
  }
  // A linked grid makes its charts agree, which would overwrite the ones that do not.
  if (payload.sync?.symbol && differ(pane => `${pane.symbol}|${pane.exchange}`)) return 'the charts are linked by symbol but show different symbols';
  if (payload.sync?.interval && differ(interval)) return 'the charts are linked by interval but show different intervals';
  return '';
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
export function readGridFile(text) {
  const payload = parseWorkspacePayload(text);
  const refusal = gridViewRefusal(payload);
  if (refusal) throw new Error(refusal);
  for (const pane of payload.panes) pane.interval = ALIASES[pane.interval] || pane.interval;
  return payload;
}

/** The grid's payload as a named document the workspace tier accepts. */
export function gridDocument(payload, { name = 'Chart grid', now = Date.now() } = {}) {
  return parseWorkspaceDocument({ kind: 'workspace', version: 1, id: `grid-${now}`, name, createdAt: now, updatedAt: now, ...payload });
}
