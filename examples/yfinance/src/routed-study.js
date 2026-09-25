import { registerIndicator } from '/dist/openalgo-charts.mjs';

/**
 * A study that lives in its own pane but has things to say about the candles.
 * Its Buy and Sell plates and its range box name the price pane, so they sit
 * on the bars that fired rather than on the histogram; the crossing dots and
 * the latest reading stay with the histogram. The Signals on price input sends
 * the plates back to the study's own layer, which is the only difference a
 * descriptor needs to route an output.
 */
export function routedSignalDescriptor() {
  return {
    id: 'routed-signal-sample', name: 'Routed signal sample', category: 'Examples',
    placement: 'pane',
    inputs: [
      { key: 'length', type: 'number', label: 'Length', default: 10, min: 2, max: 100, step: 1 },
      { key: 'onPrice', type: 'boolean', label: 'Signals on price', default: true },
    ],
    plots: [{ key: 'momentum', type: 'histogram', title: 'Momentum', style: { color: '#64748b' } }],
    calc(bars, settings) {
      const n = Math.max(2, Math.floor(Number(settings.length) || 10));
      return { momentum: bars.map((bar, i) => (i < n ? null : bar.close - bars[i - n].close)) };
    },
    markers({ bars, values, settings }) {
      const out = [];
      for (let i = 1; i < bars.length; i++) {
        const before = values.momentum[i - 1], now = values.momentum[i];
        if (before == null || now == null || Math.sign(before) === Math.sign(now)) continue;
        const up = now > 0, color = up ? '#26a69a' : '#ef5350';
        out.push({
          time: bars[i].time, position: up ? 'belowBar' : 'aboveBar', shape: up ? 'labelUp' : 'labelDown',
          size: 'small', color, text: up ? 'Buy' : 'Sell', id: `signal:${bars[i].time}`,
          ...(settings.onPrice === false ? {} : { overlay: true }),
        });
        out.push({ time: bars[i].time, position: 'atPrice', price: now, shape: 'circle', size: 'tiny', color });
      }
      return out;
    },
    draws({ bars, values }) {
      const last = bars.length - 1;
      if (last < 30) return [];
      const recent = bars.slice(last - 30);
      return [
        {
          kind: 'box', overlay: true, color: '#4f8cff', fillColor: '#4f8cff', opacity: 0.08,
          from: { time: recent[0].time, price: Math.max(...recent.map(bar => bar.high)) },
          to: { time: bars[last].time, price: Math.min(...recent.map(bar => bar.low)) },
          text: '30-bar range', verticalAlign: 'top', id: 'routed-range',
          tooltip: 'The range the latest signals fired in',
        },
        {
          kind: 'label', plot: 'momentum', align: 'left', color: '#64748b', text: 'Now',
          at: { time: bars[last].time, price: values.momentum[last] ?? 0 },
        },
      ];
    },
  };
}

export function initRoutedStudy() {
  registerIndicator(routedSignalDescriptor());
}
