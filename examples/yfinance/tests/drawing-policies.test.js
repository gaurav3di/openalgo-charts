// Drawing policies in the reference host: the session marks the host
// places (read-only, transient, unlisted), and the properties bar and the
// chart menu drawing a read-only selection as read-only rather than
// offering controls the controller would refuse.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installDom } from './fake-dom.js';
import { makeApp, line, text, hover, T0 } from './draw-host.js';

vi.mock('../src/persist.js', () => ({ autosave: vi.fn() }));
const { mountPropertiesBar } = await import('../src/properties.js');
const { addSessionMark, sessionMarks, clearSessionMarks, SESSION_MARK_POLICY } = await import('../src/session-marks.js');
const { drawingMenuState } = await import('../src/menus.js');

describe('session marks', () => {
  it('are read-only, transient and unlisted, and only the host clears them', () => {
    const { draw } = makeApp();
    const mine = line(draw);
    const mark = addSessionMark(draw, { time: T0 + 600, price: 101.5 });
    expect(mark.tool).toBe('horizontal-line');
    expect(mark.points).toEqual([{ time: T0 + 600, price: 101.5 }]);
    expect(mark.policy).toEqual(SESSION_MARK_POLICY);
    expect(SESSION_MARK_POLICY).toEqual({ editable: false, persistent: false, listed: false });
    // Placing one is the host's act, not a step the user takes back.
    draw.undo();
    expect(draw.get(mark.id)).toBeDefined();
    expect(draw.get(mine.id)).toBeUndefined();
    draw.redo();
    // Never saved, never removed or moved by a user path.
    expect(draw.toJSON().drawings.map((d) => d.id)).toEqual([mine.id]);
    expect(draw.remove(mark.id)).toBe(false);
    draw.clear();
    expect(sessionMarks(draw).map((d) => d.id)).toEqual([mark.id]);
    const again = addSessionMark(draw, { time: T0 + 1200, price: 99 });
    expect(clearSessionMarks(draw)).toBe(2);
    expect(draw.get(again.id)).toBeUndefined();
    expect(sessionMarks(draw)).toEqual([]);
  });
});

describe('the chart menu\'s drawing rows', () => {
  it('count and target only what the user may delete, and the marks the host may clear', () => {
    const { draw } = makeApp();
    const mine = line(draw);
    const mark = addSessionMark(draw, { time: T0 + 600, price: 100 });
    draw.select(mark.id);
    expect(drawingMenuState(draw)).toEqual({ removable: 1, deletable: null, copyable: mark.id, marks: 1 });
    draw.select(mine.id);
    expect(drawingMenuState(draw)).toEqual({ removable: 1, deletable: mine.id, copyable: mine.id, marks: 1 });
    expect(drawingMenuState(null)).toEqual({ removable: 0, deletable: null, copyable: null, marks: 0 });
  });
});

describe('the properties bar on a read-only selection', () => {
  let dom, app, chart, draw, bar;
  const q = (sel) => bar.el.querySelector(sel);

  beforeEach(() => {
    dom = installDom();
    ({ app, chart, draw } = makeApp());
    bar = mountPropertiesBar(app, dom.stage);
    bar.attach();
  });

  it('shows what it is and offers only a copy, never a control that would be refused', () => {
    const mark = addSessionMark(draw, { time: T0 + 600, price: 100 });
    draw.select(mark.id);
    expect(bar.el.hidden).toBe(false);
    expect(q('.pb-note').textContent).toBe('Read-only');
    expect(bar.el.querySelectorAll('[data-path]')).toHaveLength(0);
    for (const act of ['lock', 'visible', 'delete']) expect(q(`[data-act="${act}"]`), act).toBeNull();
    q('[data-act="duplicate"]').click();
    const [copy] = draw.selection();
    expect(copy).not.toBe(mark.id);
    expect(draw.get(copy).policy).toBeUndefined();
    // The copy is the user's own, so the full bar comes back for it.
    expect(q('[data-act="delete"]')).not.toBeNull();
    expect(q('.pb-note')).toBeNull();
  });

  it('opens no text editor on a read-only text drawing, from Enter or a double-click', () => {
    const note = text(draw, { policy: { editable: false } });
    draw.select(note.id);
    dom.document.body.fire('keydown', { key: 'Enter' });
    expect(bar.editor()).toBeNull();
    const canvas = dom.document.createElement('canvas');
    dom.chart.appendChild(canvas);
    hover(chart, note.id);
    canvas.fire('dblclick');
    expect(bar.editor()).toBeNull();
    expect(draw.get(note.id).text.value).toBe('Hello');
  });
});
