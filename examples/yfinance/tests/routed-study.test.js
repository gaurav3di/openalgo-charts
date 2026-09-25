import { describe, expect, it } from 'vitest';
import { getIndicator } from '/dist/openalgo-charts.mjs';
import { initRoutedStudy, routedSignalDescriptor } from '../src/routed-study.js';

const bars = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 4);
  return { time: 1_700_000_000 + i * 86400, open: close - 1, high: close + 2, low: close - 2, close };
});

function outputs(settings) {
  const descriptor = routedSignalDescriptor();
  const values = descriptor.calc(bars, settings);
  return {
    marks: descriptor.markers({ bars, values, settings }),
    shapes: descriptor.draws({ bars, values, settings }),
  };
}

describe('routed signal sample', () => {
  it('registers an opt-in pane study under Examples', () => {
    initRoutedStudy();
    expect(getIndicator('routed-signal-sample')).toMatchObject({ category: 'Examples', placement: 'pane' });
  });

  it('sends its plates and range box to the price pane and keeps the rest with the histogram', () => {
    const { marks, shapes } = outputs({ length: 10, onPrice: true });
    const plates = marks.filter(mark => mark.shape === 'labelUp' || mark.shape === 'labelDown');
    const dots = marks.filter(mark => mark.shape === 'circle');
    expect(plates.length).toBeGreaterThan(1);
    expect(plates.every(mark => mark.overlay === true && mark.plot === undefined)).toBe(true);
    expect(dots).toHaveLength(plates.length);
    expect(dots.every(mark => mark.overlay === undefined && mark.plot === undefined)).toBe(true);
    expect(shapes.map(shape => [shape.kind, shape.overlay ?? null, shape.plot ?? null]))
      .toEqual([['box', true, null], ['label', null, 'momentum']]);
  });

  it('keeps the plates with the histogram when Signals on price is off', () => {
    const { marks } = outputs({ length: 10, onPrice: false });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every(mark => mark.overlay === undefined && mark.plot === undefined)).toBe(true);
  });
});
