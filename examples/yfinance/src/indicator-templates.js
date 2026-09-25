import { registeredIndicators } from '/dist/openalgo-charts.mjs';
import { parseIndicatorStates, parseIndicatorTemplate, planIndicatorTemplate } from '/dist/openalgo-charts.workspace.mjs';

export function templateUnavailableReason(app, target) {
  if (!target?.current() || target.chart.isDestroyed) return 'The chart changed; reopen Templates for its current owner';
  if (app.workspaceLoading || app.applyingTemplate || app.chartSettingsEditing || app.restoringSecondary
    || (target.pane === 2 ? app.loading2 || app.loadFailed2 : app.loading || app.loadFailed)
    || !target.chart.primaryBars().length) return 'Finish loading or settings changes before using templates';
  if (app.replayPicking || app.replayLoading) return 'Finish replay selection and loading before using templates';
  return null;
}

function assertOwner(app, target) {
  const reason = templateUnavailableReason(app, target);
  if (reason) throw new Error(reason);
}

export function captureIndicatorTemplate(app, target) {
  assertOwner(app, target);
  // Capture every study so source dependencies travel with their consumers.
  // The shared parser keeps graph identities and drops only legacy copy IDs.
  return parseIndicatorTemplate({ kind: 'indicator-template', version: 1,
    id: 'capture', name: 'Captured studies', createdAt: 0, updatedAt: 0,
    indicators: target.chart.getState().indicators || [],
  }).indicators;
}

/** Apply to the captured chart's displayed data; never reload a source to add studies. */
export function applyIndicatorTemplate(app, target, incoming, mode) {
  assertOwner(app, target);
  const chart = target.chart, before = chart.getState();
  const previous = parseIndicatorStates(before.indicators || []);
  const planned = planIndicatorTemplate(previous, incoming, mode,
    new Set(registeredIndicators().map(item => item.id)), chart.panes().length);
  if (mode === 'append' && planned.length === previous.length) return previous;
  const retained = { drawings: before.drawings, alerts: before.alerts };
  const restore = (indicators, extra) => {
    const report = chart.restoreState({ version: 1, indicators, ...retained, ...extra });
    if (!report.applied) throw new Error(report.reason || 'The template could not be applied');
    if (report.indicators !== indicators.length) throw new Error('The chart did not restore all studies');
  };
  app.applyingTemplate = true;
  try {
    restore(planned, { panes: mode === 'append' ? before.panes : before.panes?.slice(0, 1) });
    if (!target.current() || chart.isDestroyed) throw new Error('The chart changed while applying its template');
    return parseIndicatorStates(chart.getState().indicators || []);
  } catch (error) {
    if (target.current() && !chart.isDestroyed) {
      try { restore(previous, { panes: before.panes, viewport: before.viewport, barSpacing: before.barSpacing }); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Template application and recovery failed'); }
    }
    throw error;
  } finally {
    app.applyingTemplate = false;
    if (target.pane === 1 && target.current() && !chart.isDestroyed) {
      app.activeIndicators = parseIndicatorStates(chart.getState().indicators || []);
    }
  }
}
