import { describe, expect, it, vi } from 'vitest';
vi.mock('/dist/openalgo-charts.mjs', async original => ({ ...await original(),
  registeredIndicators: () => [{ id: 'custom-average' }] }));
vi.mock('/dist/openalgo-charts.workspace.mjs', () => import('../../../src/workspace/index.ts'));
import { captureIndicatorTemplate, applyIndicatorTemplate } from '../src/indicator-templates.js';

const reference = instanceId => ({ kind: 'indicator', instanceId, plotKey: 'ma' });
const graph = () => [
  { indicatorId: 'custom-average', instanceId: 'consumer', studyInputs: ['source'], settings: { source: reference('producer') }, paneIndex: 0 },
  { indicatorId: 'custom-average', instanceId: 'producer', settings: { length: 2 }, paneIndex: 0 },
];
function setup() {
  let state = { version: 1, indicators: graph(), panes: [{ weight: 1 }] };
  const chart = { getState: () => structuredClone(state), primaryBars: () => [{ time: 1, close: 1 }], panes: () => [{}],
    restoreState: vi.fn(next => { state = { ...state, ...structuredClone(next) }; return { applied: true, indicators: next.indicators.length }; }) };
  const app = { chart }, target = { chart, pane: 1, current: () => true };
  return { app, target, chart, get state() { return state; } };
}

describe('reference dependency template capture', () => {
  it('captures the complete source graph before identity stripping can break it', () => {
    const { app, target, state } = setup();
    const result = captureIndicatorTemplate(app, target);
    expect(result).toEqual(graph());
    result[0].settings.source.instanceId = 'changed';
    expect(state.indicators[0].settings.source).toEqual(reference('producer'));
  });

  it('appends independent copies while keeping the original source graph and primary mirror intact', () => {
    const h = setup(), captured = captureIndicatorTemplate(h.app, h.target);
    applyIndicatorTemplate(h.app, h.target, captured, 'append');
    applyIndicatorTemplate(h.app, h.target, captured, 'append');
    expect(h.state.indicators).toHaveLength(6);
    expect(new Set(h.state.indicators.map(item => item.instanceId)).size).toBe(6);
    for (let i = 0; i < 6; i += 2) {
      expect(h.state.indicators[i].settings.source).toEqual(reference(h.state.indicators[i + 1].instanceId));
    }
    expect(h.state.indicators.slice(0, 2)).toEqual(graph());
    expect(h.app.activeIndicators).toEqual(h.state.indicators);
  });

  it('rejects unavailable external dependencies before capture or restore', () => {
    const h = setup();
    h.chart.getState = () => ({ version: 1, indicators: [graph()[0]] });
    expect(() => captureIndicatorTemplate(h.app, h.target)).toThrow(/external|missing/i);
    expect(h.chart.restoreState).not.toHaveBeenCalled();
  });
});
