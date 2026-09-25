import { afterEach, describe, expect, it } from 'vitest';
import { Chart } from '../src/core/chart';
import { ADX } from '../src/indicators/momentum';
import type { Bar } from '../src/model/bar';
import { registerIndicator, type IndicatorValues } from '../src/model/indicator-registry';
import { fakeDocument } from './helpers/fake-dom';

registerIndicator(ADX);
const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach(chart => chart.destroy()));

const bars = (rows: readonly (readonly [number, number, number])[]): Bar[] =>
  rows.map(([high, low, close], index) => ({
    time: 1700000000 + index * 60, open: close, high, low, close, volume: 100,
  }));
const ramp = (length: number, direction = 1): Bar[] => bars(
  Array.from({ length }, (_, index) => {
    const close = 40 + direction * index;
    return [close + 1, close - 1, close] as const;
  }),
);
const asymmetric = bars([[10, 8, 9], [12, 9, 11], [11, 7, 8], [13, 9, 12], [12, 10, 11]]);
const expected = {
  plusDi: [null, null, 200 / 7, 600 / 17, 24],
  minusDi: [null, null, 200 / 7, 200 / 17, 8],
  adx: [null, null, null, 25, 37.5],
};

function expectValues(actual: IndicatorValues, wanted: Record<string, readonly (number | null)[]>): void {
  for (const [key, values] of Object.entries(wanted)) {
    expect(actual[key], key).toHaveLength(values.length);
    values.forEach((value, index) => {
      if (value === null) expect(actual[key][index], `${key}[${index}]`).toBeNull();
      else expect(actual[key][index], `${key}[${index}]`).toBeCloseTo(value, 12);
    });
  }
}

describe('directional movement and range use the same seed window', () => {
  it('matches independently calculated directional reversals and strength', () => {
    // At bar 2, TR seeds at 7/2 and both movement means at 1. The next
    // movement means are 3/2 and 1/2, giving DX 50 and the first ADX 25.
    expectValues(ADX.calc(asymmetric, { period: 2, adxPeriod: 2 }, {}), expected);
  });

  it.each([1, -1])('keeps unit movement over a two-unit range at fifty for direction %s', direction => {
    const output = ADX.calc(ramp(9, direction), { period: 3, adxPeriod: 3 }, {});
    expectValues(output, {
      plusDi: [null, null, null, ...Array<number>(6).fill(direction === 1 ? 50 : 0)],
      minusDi: [null, null, null, ...Array<number>(6).fill(direction === -1 ? 50 : 0)],
      adx: [null, null, null, null, null, 100, 100, 100, 100],
    });
  });

  it('preserves default warmup while removing the directional seed bias', () => {
    const output = ADX.calc(ramp(30), {}, {});
    expect(output.plusDi.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(output.plusDi.slice(14)).toEqual(Array(16).fill(50));
    expect(output.minusDi.slice(14)).toEqual(Array(16).fill(0));
    expect(output.adx.slice(0, 27)).toEqual(Array(27).fill(null));
    expect(output.adx.slice(27)).toEqual([100, 100, 100]);
  });

  it('keeps period-one readings and the existing zero-range carry behavior', () => {
    const data = bars([[10, 8, 9], [12, 9, 11], [11, 7, 8], [8, 8, 8], [14, 11, 13], [15, 13, 14]]);
    expectValues(ADX.calc(data, { period: 1, adxPeriod: 2 }, {}), {
      plusDi: [null, 200 / 3, 0, 0, 100, 50],
      minusDi: [null, 0, 50, 50, 0, 0],
      adx: [null, null, 100, 100, 100, 100],
    });
  });

  it('leaves an entirely flat zero-range history absent', () => {
    const data = bars(Array.from({ length: 8 }, () => [10, 10, 10] as const));
    expectValues(ADX.calc(data, { period: 2, adxPeriod: 2 }, {}), {
      plusDi: Array(8).fill(null), minusDi: Array(8).fill(null), adx: Array(8).fill(null),
    });
  });

  it('treats equally strong opposing movements as zero in both directions', () => {
    const data = bars([[10, 8, 9], [12, 6, 9], [11, 7, 9], [13, 5, 9], [13, 5, 9], [14, 4, 9]]);
    expectValues(ADX.calc(data, { period: 2, adxPeriod: 2 }, {}), {
      plusDi: [null, null, 0, 0, 0, 0], minusDi: [null, null, 0, 0, 0, 0],
      adx: [null, null, null, 0, 0, 0],
    });
  });

  it('preserves the existing held readings after a missing OHLC observation', () => {
    const data = ramp(9);
    data[6] = { ...data[6], open: NaN, high: NaN, low: NaN, close: NaN };
    expectValues(ADX.calc(data, { period: 3, adxPeriod: 3 }, {}), {
      plusDi: [null, null, null, 50, 50, 50, 50, 50, 50],
      minusDi: [null, null, null, 0, 0, 0, 0, 0, 0],
      adx: [null, null, null, null, null, 100, 100, 100, 100],
    });
  });

  it('produces each expected prefix without requiring later bars', () => {
    for (let length = 0; length <= asymmetric.length; length++) {
      const wanted = Object.fromEntries(Object.entries(expected).map(([key, values]) => [key, values.slice(0, length)]));
      expectValues(ADX.calc(asymmetric.slice(0, length), { period: 2, adxPeriod: 2 }, {}), wanted);
    }
  });

  it('recomputes native forming updates without changing the completed prefix', () => {
    const document = fakeDocument();
    const pending = new Map<number, () => void>();
    let handle = 0;
    const chart = new Chart(document.createElement('div'), {
      document, timezone: 'Etc/UTC', pixelRatio: () => 1, shortcuts: false,
      raf: {
        schedule: callback => { pending.set(++handle, callback); return handle; },
        cancel: id => { pending.delete(id); },
      },
    });
    charts.push(chart);
    chart.applySize(800, 600);
    const source = chart.addSeries('candlestick');
    source.setData(asymmetric.slice(0, 4));
    const study = chart.addIndicator('adx', { period: 2, adxPeriod: 2 });
    const prefix = Object.fromEntries(Object.entries(expected).map(([key, values]) => [key, values.slice(0, 4)]));
    expectValues(study.values(), prefix);

    const changed = { ...asymmetric[3], high: 14, close: 13 };
    source.update(changed);
    const revised = {
      plusDi: [null, null, 200 / 7, 800 / 19],
      minusDi: [null, null, 200 / 7, 200 / 19],
      adx: [null, null, null, 30],
    };
    expectValues(study.values(), revised);
    source.update(changed);
    expectValues(study.values(), revised);
    source.update(asymmetric[3]);
    expectValues(study.values(), prefix);
    source.update(asymmetric[4]);
    expectValues(study.values(), expected);
  });
});
