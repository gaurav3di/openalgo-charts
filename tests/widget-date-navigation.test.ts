/**
 * The packaged go-to flow: the widget loads the history a date needs through
 * its managed controller, places the date only after the accepted load, and
 * leaves that placement alone when later data arrives.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bar, BarsRequest, DataFeed } from '../src/index';
import { zonedWallClockToUtcSeconds } from '../src/feed/time';
import { ReplayController } from '../src/replay/controller';
import { registerInterval } from '../src/feed/intervals';
import { createWidget, type Widget, type WidgetOptions } from '../src/widget/widget';
import { openDateNavigation } from '../src/widget/date-navigation-dialog';
import type { DateNavigationResult } from '../src/widget/date-navigator';
import { ensureWindowGlobal, fakeContainer, fakeWidgetDocument, fireKey, type FakeElement } from './helpers/fake-dom-widget';

beforeAll(ensureWindowGlobal);

const at = (y: number, m: number, d: number, hh = 0, mm = 0): number => zonedWallClockToUtcSeconds(y, m, d, hh, mm, 0, 'Asia/Kolkata');
const bar = (time: number, close = 100): Bar => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });
/** Weekday sessions stamped at the 09:15 open, 2023-01-02 through 2024-06-28. */
const SESSIONS: Bar[] = [];
for (let day = 0; ; day++) {
  const time = at(2023, 1, 2 + day, 9, 15);
  if (time > at(2024, 6, 28, 23, 59)) break;
  const weekday = new Date((time + 5.5 * 3600) * 1000).getUTCDay();
  if (weekday !== 0 && weekday !== 6) SESSIONS.push(bar(time, 100 + SESSIONS.length));
}
const NOW = at(2024, 6, 28, 16, 0);
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const live: Widget[] = [];
afterEach(() => { for (const widget of live.splice(0)) if (!widget.isDestroyed) widget.destroy(); });

function make(options: WidgetOptions = {}) {
  const doc = fakeWidgetDocument();
  const widget = createWidget(fakeContainer(doc) as unknown as HTMLElement, {
    document: doc as unknown as Document, pixelRatio: () => 1,
    raf: { schedule: cb => { cb(); return 1; }, cancel: () => {} },
    symbol: 'NIFTY', exchange: 'NSE', interval: '1d', lookbackBars: 60, now: () => NOW * 1000, ...options,
  });
  widget.chart.applySize(800, 600);
  live.push(widget);
  return { widget, root: widget.root as unknown as FakeElement, doc };
}

/** A date-range feed over SESSIONS that records every request. */
function rangeFeed(requests: BarsRequest[], extra: Partial<DataFeed> = {}): DataFeed {
  return {
    getBars: async request => {
      requests.push(request);
      return SESSIONS.filter(value => value.time >= (request.from ?? -Infinity) && value.time <= (request.to ?? Infinity));
    },
    ...extra,
  };
}

const centreTime = (widget: Widget): number | undefined => {
  const view = widget.chart.getVisibleLogicalRange();
  return widget.chart.dataLayer.indexToTime(Math.round((view.from + view.to) / 2));
};

/** A range feed whose requests after the first wait for `release`. */
function gatedFeed(requests: BarsRequest[]): { feed: DataFeed; release(): void } {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { release, feed: { getBars: async request => {
    requests.push(request);
    if (requests.length > 1) await gate;
    return SESSIONS.filter(value => value.time >= (request.from ?? -Infinity) && value.time <= (request.to ?? Infinity));
  } } };
}

describe('widget go-to flow', () => {
  it('loads the missing history in one reach and keeps the placement through later data', async () => {
    const requests: BarsRequest[] = [];
    let push!: (value: Bar) => void;
    const { widget } = make({ feed: rangeFeed(requests, { subscribeBars: (_request, onBar) => { push = onBar; return () => {}; } }) });
    await flush();
    const loaded = widget.series.getData().length;
    expect(loaded).toBeLessThan(60);
    const target = at(2023, 10, 16, 9, 15);
    const result = await widget.goTo({ from: at(2023, 10, 16) });
    expect(result).toEqual({ status: 'placed', from: target, to: target });
    expect(requests).toHaveLength(2);
    expect(requests[1].from).toBeLessThanOrEqual(at(2023, 10, 16));
    expect(widget.series.getData().length).toBeGreaterThan(loaded);
    expect(centreTime(widget)).toBe(target);

    push(bar(at(2024, 7, 1, 9, 15), 400));
    await flush();
    expect(widget.series.getData()[widget.series.getData().length - 1]?.time).toBe(at(2024, 7, 1, 9, 15));
    expect(centreTime(widget)).toBe(target);
    await widget.reload();
    await flush();
    expect(requests).toHaveLength(3);
    expect(centreTime(widget)).toBe(target);
  });

  it('places a date requested during the first load after that load, not before it', async () => {
    const requests: BarsRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const base = rangeFeed(requests);
    const { widget } = make({ feed: { getBars: async request => { await gate; return base.getBars(request); } } });
    // Far enough from the newest bar that centring it needs no shift toward the right margin.
    const target = at(2024, 2, 15, 9, 15);
    const pending = widget.goTo({ from: at(2024, 2, 15) });
    await flush();
    release();
    expect(await pending).toEqual({ status: 'placed', from: target, to: target });
    expect(centreTime(widget)).toBe(target);
  });

  it('cancels a request when the symbol changes and when the widget is destroyed', async () => {
    const requests: BarsRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const base = rangeFeed(requests);
    const feed: DataFeed = { getBars: async request => {
      if (requests.length > 0) await gate;
      return base.getBars(request);
    } };
    const { widget } = make({ feed });
    await flush();
    const changed = widget.goTo({ from: at(2023, 10, 16) });
    await flush();
    widget.setSymbol('BANKNIFTY');
    release();
    expect(await changed).toEqual({ status: 'cancelled' });

    const second = make({ feed: { getBars: () => new Promise<Bar[]>(() => {}) } }).widget;
    const destroyed = second.goTo({ from: at(2023, 10, 16) });
    second.destroy();
    expect(await destroyed).toEqual({ status: 'cancelled' });
  });

  it('settles at once when the interval changes during a history load', async () => {
    const requests: BarsRequest[] = [];
    const { feed, release } = gatedFeed(requests);
    const { widget } = make({ feed });
    await flush();
    const settled = vi.fn();
    void widget.goTo({ from: at(2023, 10, 16) }).then(settled);
    await flush();
    expect(requests).toHaveLength(2);
    widget.setInterval('1h');
    await flush();
    expect(settled).toHaveBeenCalledWith({ status: 'cancelled' });
    release();
  });

  it('settles at once when the context changes while it waits for a load that never finishes', async () => {
    // A feed that ignores cancellation: the first load never resolves.
    for (const change of [
      (widget: Widget) => { widget.setSymbol('BANKNIFTY'); },
      (widget: Widget) => { widget.restoreState({ symbol: 'BANKNIFTY', exchange: 'NSE', interval: '1d' }); },
      (widget: Widget) => { widget.setInterval('1h'); },
    ]) {
      const { widget } = make({ feed: { getBars: () => new Promise<Bar[]>(() => {}) } });
      const settled = vi.fn();
      void widget.goTo({ from: at(2024, 2, 15) }).then(settled);
      await flush();
      expect(settled).not.toHaveBeenCalled();
      change(widget);
      await flush();
      expect(settled).toHaveBeenCalledWith({ status: 'cancelled' });
    }
  });

  it('settles at once when restoreState moves to another instrument during a history load', async () => {
    const requests: BarsRequest[] = [];
    const { feed, release } = gatedFeed(requests);
    const { widget } = make({ feed });
    await flush();
    const settled = vi.fn();
    void widget.goTo({ from: at(2023, 10, 16) }).then(settled);
    await flush();
    widget.restoreState({ symbol: 'BANKNIFTY', exchange: 'NSE', interval: '1d' });
    await flush();
    expect(settled).toHaveBeenCalledWith({ status: 'cancelled' });
    release();
  });

  it('loads nothing during replay and places nothing beyond the replay cursor', async () => {
    const requests: BarsRequest[] = [];
    const { widget } = make({ feed: rangeFeed(requests) });
    await flush();
    const bars = widget.series.getData();
    const replay = new ReplayController(widget.chart, { startIndex: 20 });
    try {
      const count = requests.length;
      expect(await widget.goTo({ from: at(2023, 1, 10) }))
        .toEqual({ status: 'partial', history: 'unavailable', from: bars[0].time, to: bars[0].time });
      expect(await widget.goTo({ from: bars[bars.length - 2].time })).toEqual({ status: 'no-data' });
      expect(await widget.goTo({ from: bars[10].time })).toMatchObject({ status: 'placed', from: bars[10].time });
      expect(requests).toHaveLength(count);
    } finally { replay.stop(); }
  });

  it('lets the latest of several quick requests win', async () => {
    const requests: BarsRequest[] = [];
    const { widget } = make({ feed: rangeFeed(requests) });
    await flush();
    const first = widget.goTo({ from: at(2023, 3, 1) });
    const second = widget.goTo({ from: at(2023, 6, 1) });
    const third = widget.goTo({ from: at(2023, 10, 16) });
    expect(await first).toEqual({ status: 'cancelled' });
    expect(await second).toEqual({ status: 'cancelled' });
    expect(await third).toMatchObject({ status: 'placed', from: at(2023, 10, 16, 9, 15) });
    expect(centreTime(widget)).toBe(at(2023, 10, 16, 9, 15));
  });

  it('keeps empty older windows apart from exhaustion, and loads nothing while the controller is paused', async () => {
    const requests: BarsRequest[] = [];
    const listed = at(2024, 3, 1);
    const { widget } = make({ feed: { getBars: async request => {
      requests.push(request);
      return SESSIONS.filter(value => value.time >= Math.max(listed, request.from ?? -Infinity) && value.time <= (request.to ?? Infinity));
    } } });
    await flush();
    // The reach loads the listing's first sessions, then finds only empty windows.
    const first = SESSIONS.find(value => value.time >= listed)!.time;
    expect(widget.series.getData()[0].time).toBeGreaterThan(first);
    const result = await widget.goTo({ from: at(2023, 1, 10) });
    expect(result).toEqual({ status: 'partial', history: 'empty', from: first, to: first });
    expect(widget.series.getData()[0].time).toBe(first);
    expect(widget.dataController?.getState().hasMore).toBeNull();

    const paused = make({ feed: rangeFeed([]) }).widget;
    await flush();
    const before = paused.series.getData()[0].time;
    paused.dataController?.setPaused(true);
    expect(await paused.goTo({ from: at(2023, 1, 10) })).toEqual({ status: 'partial', history: 'unavailable', from: before, to: before });
    expect(paused.series.getData()[0].time).toBe(before);
  });

  it('reports provider exhaustion and navigates host-supplied bars without a feed', async () => {
    const requests: BarsRequest[] = [];
    const { widget } = make({ feed: rangeFeed(requests, { getBarsPage: async () => ({ bars: [], hasMore: false }) }) });
    await flush();
    const first = widget.series.getData()[0].time;
    expect(await widget.goTo({ from: at(2023, 1, 10) })).toEqual({ status: 'partial', history: 'exhausted', from: first, to: first });

    const plain = make().widget;
    plain.series.setData(SESSIONS.slice(-40));
    expect(await plain.goTo({ from: at(2023, 1, 10) })).toMatchObject({ status: 'partial', history: 'unavailable' });
    const recent = SESSIONS[SESSIONS.length - 10].time;
    expect(await plain.goTo({ from: recent })).toMatchObject({ status: 'placed', from: recent });
  });
});

describe('widget go-to panel', () => {
  it('opens from the top bar, places a date and closes', async () => {
    const requests: BarsRequest[] = [];
    const { widget, root } = make({ feed: rangeFeed(requests) });
    await flush();
    const open = root.querySelector('.oac-topbar__goto')!;
    expect(open.textContent).toBe('Go to');
    open.click();
    const panel = root.querySelector('.oac-goto')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    const [date, time] = panel.querySelectorAll('input');
    expect(date.type).toBe('date');
    expect(time.type).toBe('time');
    date.value = '2023-10-16';
    time.value = '';
    panel.querySelector('[data-action="go-to"]')!.click();
    await flush();
    expect(root.querySelector('.oac-goto')).toBeNull();
    expect(centreTime(widget)).toBe(at(2023, 10, 16, 9, 15));
    expect(root.querySelector('.oac-statusline')?.textContent).toContain('Showing');
  });

  it('keeps the panel open with the reason when there is nothing to show', async () => {
    const requests: BarsRequest[] = [];
    const { widget, root } = make({ feed: rangeFeed(requests) });
    await flush();
    const view = widget.chart.getVisibleLogicalRange();
    widget.openDateNavigation();
    const panel = root.querySelector('.oac-goto')!;
    const inputs = panel.querySelectorAll('input');
    inputs[0].value = '2030-01-01';
    fireKey(inputs[0], 'Enter');
    await flush();
    const message = panel.querySelector('.oac-goto__message')!;
    expect(message.textContent).toContain('No bars at or after');
    expect(widget.chart.getVisibleLogicalRange()).toEqual(view);

    panel.querySelector('[data-mode="range"]')!.click();
    const fields = panel.querySelectorAll('input');
    // Daily bars: two dates and no times.
    expect(fields.filter(field => !field.closest('[hidden]')).map(field => field.type)).toEqual(['date', 'date']);
    fields[0].value = '2024-06-10';
    fields[2].value = '2024-06-05';
    panel.querySelector('[data-action="go-to"]')!.click();
    await flush();
    expect(message.textContent).toBe('The end must not be before the start');

    fields[0].value = '2024-06-08';
    fields[2].value = '2024-06-09';
    panel.querySelector('[data-action="go-to"]')!.click();
    await flush();
    expect(message.textContent).toContain('No bars between');
    expect(widget.chart.getVisibleLogicalRange()).toEqual(view);

    fields[0].value = '2024-06-03';
    fields[2].value = '2024-06-14';
    panel.querySelector('[data-action="go-to"]')!.click();
    await flush();
    expect(root.querySelector('.oac-goto')).toBeNull();
    const placed = widget.chart.getVisibleLogicalRange();
    expect(widget.chart.dataLayer.indexToTime(Math.ceil(placed.from))).toBe(at(2024, 6, 3, 9, 15));
    expect(widget.chart.dataLayer.indexToTime(Math.floor(placed.to))).toBe(at(2024, 6, 14, 9, 15));
  });

  it('cancels its loading request when dismissed, so the view stays where the user left it', async () => {
    for (const dismiss of [
      (panel: FakeElement) => { panel.querySelector('.oac-dialog__head button')!.click(); },
      (panel: FakeElement) => { fireKey(panel, 'Escape'); },
    ]) {
      const requests: BarsRequest[] = [];
      const { feed, release } = gatedFeed(requests);
      const { widget, root } = make({ feed });
      await flush();
      const loaded = widget.series.getData().length;
      widget.openDateNavigation();
      const panel = root.querySelector('.oac-goto')!;
      const [date, time] = panel.querySelectorAll('input');
      date.value = '2023-10-16';
      time.value = '';
      panel.querySelector('[data-action="go-to"]')!.click();
      await flush();
      expect(panel.querySelector('.oac-goto__message')!.textContent).toBe('Loading history');
      const shown = centreTime(widget);
      dismiss(panel);
      await flush();
      expect(root.querySelector('.oac-goto')).toBeNull();
      release();
      await flush();
      // The older bars still arrive; only the jump to them is abandoned.
      expect(widget.series.getData().length).toBeGreaterThan(loaded);
      expect(centreTime(widget)).toBe(shown);
      expect(root.querySelector('.oac-statusline')?.textContent).not.toContain('Showing');
    }
  });

  it('leaves a newer request alone when a panel whose request was replaced is dismissed', async () => {
    const requests: BarsRequest[] = [];
    const { feed, release } = gatedFeed(requests);
    const { widget, root } = make({ feed });
    await flush();
    widget.openDateNavigation();
    const panel = root.querySelector('.oac-goto')!;
    panel.querySelectorAll('input')[0].value = '2023-10-16';
    panel.querySelector('[data-action="go-to"]')!.click();
    await flush();
    const newer = widget.goTo({ from: at(2023, 11, 15) });
    panel.querySelector('.oac-dialog__head button')!.click();
    await flush();
    release();
    expect(await newer).toMatchObject({ status: 'placed', from: at(2023, 11, 15, 9, 15) });
  });

  it('offers time fields only where a time can change which bar is shown', async () => {
    const daily = make({ feed: rangeFeed([]) });
    await flush();
    daily.widget.openDateNavigation();
    let panel = daily.root.querySelector('.oac-goto')!;
    const shown = (): string[] => panel.querySelectorAll('input').filter(field => !field.closest('[hidden]')).map(field => field.type);
    expect(shown()).toEqual(['date']);
    expect(panel.querySelector('.oac-goto__hint')!.textContent).toBe('Dates are in Asia/Kolkata.');

    const hourly = make({ interval: '1h', feed: rangeFeed([]) });
    await flush();
    hourly.widget.openDateNavigation();
    panel = hourly.root.querySelector('.oac-goto')!;
    expect(shown()).toEqual(['date', 'time']);
    expect(panel.querySelector('.oac-goto__hint')!.textContent).toContain('Times are in Asia/Kolkata.');
  });

  it('greys Go to with its reason on an interval without time buckets', async () => {
    const off = registerInterval({ code: 'T50', bucketing: { mode: 'ticks', count: 50 } });
    try {
      const { widget, root } = make({ interval: 'T50' });
      const open = root.querySelector('.oac-topbar__goto')!;
      expect(open.getAttribute('aria-disabled')).toBe('true');
      open.click();
      expect(root.querySelector('.oac-goto')).toBeNull();
      expect(widget.openDateNavigation()).toBe(false);
      widget.setInterval('1d');
      expect(open.getAttribute('aria-disabled')).toBe('false');
      open.click();
      expect(root.querySelector('.oac-goto')).not.toBeNull();

      const compact = make({ interval: 'T50', mobile: 'always' });
      compact.root.querySelector('[data-mobile-action="more"]')!.click();
      const entry = compact.root.querySelector('[data-mobile-action="go-to"]')!;
      expect(entry.getAttribute('aria-disabled')).toBe('true');
      entry.click();
      expect(compact.root.querySelector('.oac-goto')).toBeNull();
    } finally { off(); }
  });

  it('shows a pending request it did not start and reports its outcome in place', async () => {
    const { widget, root } = make({ feed: rangeFeed([]) });
    await flush();
    let settle!: (result: DateNavigationResult) => void;
    const result = new Promise<DateNavigationResult>(resolve => { settle = resolve; });
    const target = { from: at(2023, 1, 10), to: at(2023, 2, 10, 23, 59) };
    const navigate = vi.fn();
    openDateNavigation(widget.context, undefined, { navigate, pending: { target, result } });
    const panel = root.querySelector('.oac-goto')!;
    const fields = panel.querySelectorAll('input');
    expect([fields[0].value, fields[2].value]).toEqual(['2023-01-10', '2023-02-10']);
    expect(panel.querySelector('[data-mode="range"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(panel.querySelector('.oac-goto__message')!.textContent).toBe('Loading history');
    settle({ status: 'partial', history: 'exhausted', from: at(2023, 1, 2, 9, 15), to: at(2023, 1, 2, 9, 15) });
    await flush();
    expect(panel.querySelector('.oac-goto__message')!.textContent).toMatch(/^History starts at /);
    expect(root.querySelector('.oac-goto')).toBe(panel);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers the panel from the compact controls', async () => {
    const { root } = make({ mobile: 'always' });
    root.querySelector('[data-mobile-action="more"]')!.click();
    const entry = root.querySelector('[data-mobile-action="go-to"]')!;
    expect(entry.textContent).toBe('Go to');
    entry.click();
    expect(root.querySelector('.oac-goto')).not.toBeNull();
  });
});
