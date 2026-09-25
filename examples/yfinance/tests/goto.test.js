import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDom } from './helpers.js';
import { initGoTo, loadPaneHistory, widerPeriod } from '../src/goto.js';

const DAY = 86400;

describe('reference go-to history', () => {
  it('widens to the shortest period that reaches the requested time', () => {
    expect(widerPeriod('1d', '1y', 2 * 366 * DAY)).toBe('5y');
    expect(widerPeriod('1d', '1mo', 40 * DAY)).toBe('6mo');
    expect(widerPeriod('1d', '5y', 90 * 366 * DAY)).toBe('max');
    expect(widerPeriod('1d', 'max', 90 * 366 * DAY)).toBeNull();
  });

  it('stops at the longest period an interval can serve', () => {
    expect(widerPeriod('1h', '1mo', 3 * 366 * DAY)).toBe('1y');
    expect(widerPeriod('1h', '1y', 3 * 366 * DAY)).toBeNull();
    expect(widerPeriod('5m', '1mo', 90 * DAY)).toBeNull();
  });
});

describe('reference go-to loading', () => {
  let app;
  beforeEach(() => {
    fakeDom({ period: '1y' });
    app = {
      req: { symbol: 'AAPL', interval: '1d', period: '1y' },
      p2: { symbol: 'MSFT', interval: '1d', period: '1mo' },
      load: vi.fn(async () => { app.req.period = document.getElementById('period').value; }),
      loadSecondary: vi.fn(async () => true),
    };
    initGoTo(app);
  });

  it('reloads the main chart through its own load path with the wider period', async () => {
    const time = Math.floor(Date.now() / 1000) - 2 * 366 * DAY;
    expect(await loadPaneHistory(1, time)).toBe('loaded');
    expect(document.getElementById('period').value).toBe('5y');
    expect(app.load).toHaveBeenCalledTimes(1);
    expect(app.req.period).toBe('5y');
  });

  it('reports exhaustion without loading once the longest period is held', async () => {
    app.req.period = 'max';
    document.getElementById('period').value = 'max';
    expect(await loadPaneHistory(1, 0)).toBe('exhausted');
    expect(app.load).not.toHaveBeenCalled();
  });

  it('surfaces a failed load and never loads during replay', async () => {
    app.load = vi.fn(async () => { app.loadFailed = true; });
    await expect(loadPaneHistory(1, 0)).rejects.toThrow('could not load');
    app.loadFailed = false;
    app.replay = {};
    expect(await loadPaneHistory(1, 0)).toBe('unavailable');
    expect(app.load).toHaveBeenCalledTimes(1);
  });

  it('widens the second chart through its own loader', async () => {
    const time = Math.floor(Date.now() / 1000) - 100 * DAY;
    expect(await loadPaneHistory(2, time)).toBe('loaded');
    expect(app.p2.period).toBe('6mo');
    expect(app.loadSecondary).toHaveBeenCalledTimes(1);
    expect(app.load).not.toHaveBeenCalled();
    app.loadSecondary = vi.fn(async () => { app.loadFailed2 = true; return false; });
    await expect(loadPaneHistory(2, 0)).rejects.toThrow('could not load');
  });
});
