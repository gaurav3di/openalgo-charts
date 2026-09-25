import { describe, it, expect } from 'vitest';
import { workspaceFileDocument } from '../src/workspaces.js';

describe('reference layout file compatibility', () => {
  it('accepts an older wrapped file with explicit source metadata as a named document', () => {
    const layout = { schema: 2, version: 1, dataset: 'MSFT|1d|1y', chartType: 'line', indicators: [] };
    const result = workspaceFileDocument(JSON.stringify({ app: 'openalgo-charts yfinance demo', layout }), 'Desk.json');
    expect(result).toMatchObject({ kind: 'workspace', name: 'Desk', panes: [{ symbol: 'MSFT', interval: '1d', chartType: 'line' }] });
  });

  it('leaves named portable documents to the existing catalog validator', () => {
    const input = { kind: 'workspace', version: 1, name: 'Source' };
    expect(workspaceFileDocument(JSON.stringify(input), 'ignored.json')).toEqual(input);
  });

  it('drops every drawing policy from an imported document, in both chart formats', () => {
    const planted = { id: 'x', tool: 'horizontal-line', paneIndex: 0, zIndex: 0, style: {}, points: [{ time: 1, price: 2 }],
      policy: { editable: false, selectable: false, listed: false } };
    const drawings = { version: 2, drawings: [planted] };
    const named = { kind: 'workspace', version: 1, name: 'Shared', panes: [{ id: 'primary', chart: { drawings } }] };
    const result = workspaceFileDocument(JSON.stringify(named), 'Shared.json');
    expect(result.panes[0].chart.drawings.drawings[0].policy).toBeUndefined();
    expect(result.panes[0].chart.drawings.drawings[0].points).toEqual(planted.points);
    const layout = { schema: 2, version: 1, dataset: 'MSFT|1d|1y', chartType: 'line', indicators: [], drawings };
    const legacy = workspaceFileDocument(JSON.stringify({ layout }), 'Desk.json');
    expect(JSON.stringify(legacy)).not.toContain('policy');
  });

  it('refuses an ambiguous legacy source without guessing from the live chart', () => {
    expect(() => workspaceFileDocument(JSON.stringify({ schema: 2, version: 1, dataset: 'A|B|1d|1y' }), 'Old.json')).toThrow(/source|request/i);
  });

  it('rejects invalid JSON before any chart or repository action', () => {
    expect(() => workspaceFileDocument('{invalid', 'Bad.json')).toThrow();
  });
});
