// Go to a date or a range on the selected chart.
//
// The navigation rules (which bar a date names, when history is short, what
// cancels a request) are the widget tier's DateNavigator, shared with the
// packaged widget. What is this page's own is how missing history arrives:
// the reference feed serves history by period rather than by page, so older
// bars come from the shortest longer period that reaches the requested time,
// loaded through the pane's ordinary load path. The range menu then shows the
// period that was actually loaded, which is the honest record of it.
import { DateNavigator, openDateNavigation } from '/dist/openalgo-charts.widget.mjs';
import { el } from './ui.js';
import { PERIOD_DAYS, periodsFor } from './intervals.js';
import { capturePaneTarget } from './pane-target.js';

const DAY = 86400;
let app;
let panel = null;
const navigators = new Map();

export function initGoTo(a) {
  app = a;
}

/**
 * The shortest period this interval can serve that reaches `spanSec` back
 * and is longer than `period`; the longest longer one when none reaches; null
 * when `period` is already the longest the source will go.
 */
export function widerPeriod(interval, period, spanSec) {
  const held = PERIOD_DAYS[period] || 0;
  const longer = periodsFor(interval).filter(p => PERIOD_DAYS[p] > held);
  return longer.find(p => PERIOD_DAYS[p] * DAY >= spanSec) || longer[longer.length - 1] || null;
}

/** One reach for the navigator: load `pane` again with a period reaching `time`. */
export async function loadPaneHistory(pane, time) {
  // Replay owns the bars on screen, and a workspace switch is replacing them.
  if (app.replay || app.replayPicking || app.replayLoading || app.workspaceLoading) return 'unavailable';
  const request = pane === 2 ? app.p2 : app.req;
  const next = widerPeriod(request.interval, request.period, Math.floor(Date.now() / 1000) - time);
  if (!next) return 'exhausted';
  if (pane === 2) {
    app.p2.period = next;
    await app.loadSecondary();
  } else {
    el('period').value = next;
    await app.load();
  }
  if (pane === 2 ? app.loadFailed2 : app.loadFailed) throw new Error(`${request.symbol} history could not load`);
  return 'loaded';
}

function navigatorFor(pane) {
  let navigator = navigators.get(pane);
  if (!navigator) {
    navigator = new DateNavigator({
      // Read on every step: a load rebuilds the chart this pane shows.
      chart: () => (pane === 2 ? app.chart2 : app.chart),
      loadHistory: time => loadPaneHistory(pane, time),
    });
    navigators.set(pane, navigator);
  }
  return navigator;
}

/** Open the shared go-to panel for the selected chart. */
export function openGoTo(anchor) {
  const target = capturePaneTarget(app);
  const context = target && app['inspection' + target.pane]?.context;
  if (!target?.current() || !context) return false;
  panel?.close();
  panel = openDateNavigation({ ...context, status: text => { el('status').textContent = text; } }, anchor, {
    navigate: request => navigatorFor(target.pane).goTo(request),
    onClose: () => { panel = null; },
  });
  return true;
}
