import { describe, expect, it, vi } from 'vitest';
import { installDom } from './fake-dom.js';
vi.mock('../src/persist.js', () => ({ autosave: vi.fn() }));
vi.mock('../src/volume.js', async importOriginal => ({ ...await importOriginal(), volumeShown: vi.fn(() => true), setVolumeShown: vi.fn() }));
import { initMenus, openContextMenu, paneCollapseRow } from '../src/menus.js';

/** A chart that folds panes the way the engine does: pane 0 never folds. */
function foldingChart() {
  const folded = new Set();
  return {
    paneCollapsed: vi.fn(index => folded.has(index)),
    setPaneCollapsed: vi.fn((index, on) => {
      if (!(index > 0) || folded.has(index) === on) return false;
      if (on) folded.add(index); else folded.delete(index);
      return true;
    }),
    indicators: () => [],
    getDataContext: () => undefined,
  };
}

/** The right-click menu with the rows `openContextMenu` reads, in index.html's order. */
function setup(chart) {
  const { document } = installDom();
  for (const id of ['ctxmenu', 'axmenu', 'axsub', 'chart', 'status', 'chartset', 'setmodal', 'volshow']) {
    const node = document.createElement('div'); node.id = id; node.hidden = id === 'axmenu' || id === 'axsub'; document.body.appendChild(node);
  }
  const menu = document.getElementById('ctxmenu');
  const add = (tag, attr, value) => {
    const node = document.createElement(tag);
    if (attr) node.setAttribute(attr, value);
    menu.appendChild(node);
    return node;
  };
  add('button', 'data-act', 'alert-create'); add('button', 'data-act', 'alert-list'); add('hr', 'data-sec', 'alerts');
  add('hr'); add('button', 'data-act', 'delsel'); add('button', 'data-act', 'delall');
  add('hr', 'data-sec', 'clip'); for (const act of ['copy', 'cut', 'paste']) add('button', 'data-act', act);
  add('hr', 'data-sec', 'ind'); add('button', 'data-act', 'indset');
  add('hr', 'data-sec', 'pane'); add('button', 'data-act', 'panecollapse');
  add('hr', 'data-sec', 'vol'); add('button', 'data-act', 'volshow').appendChild(document.createElement('em'));
  initMenus({ chart, req: { symbol: 'X', interval: '1d', period: '1y' }, currentBars: [], draw: null });
  const open = (paneIndex, kind = 'empty') => openContextMenu({ paneIndex, point: { x: 10, y: 10 }, price: null, index: null, target: { kind, id: null } });
  const row = () => menu.querySelector('[data-act="panecollapse"]');
  const rule = () => menu.querySelector('hr[data-sec="pane"]');
  return { open, row, rule };
}

describe('reference host pane collapse', () => {
  it('offers a lower pane both ways from the right-click menu', () => {
    const chart = foldingChart();
    const rig = setup(chart);
    rig.open(2);
    expect(rig.row().hidden).toBe(false);
    expect(rig.rule().hidden).toBe(false);
    expect(rig.row().textContent).toBe('Collapse pane');
    rig.row().click();
    expect(chart.setPaneCollapsed).toHaveBeenLastCalledWith(2, true);
    rig.open(2);
    expect(rig.row().textContent).toBe('Expand pane');
    rig.row().click();
    expect(chart.setPaneCollapsed).toHaveBeenLastCalledWith(2, false);
    expect(chart.paneCollapsed(2)).toBe(false);
  });

  it('leaves the row out over the price pane and the time axis', () => {
    const rig = setup(foldingChart());
    rig.open(0);
    expect(rig.row().hidden).toBe(true);
    expect(rig.rule().hidden).toBe(true);
    rig.open(1, 'time-scale');
    expect(rig.row().hidden).toBe(true);
  });

  it('stays out of the menu on an engine without pane collapse', () => {
    expect(paneCollapseRow({}, 1)).toBeNull();
    expect(paneCollapseRow(null, 1)).toBeNull();
    expect(paneCollapseRow(foldingChart(), 0)).toBeNull();
  });
});
