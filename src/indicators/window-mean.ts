/**
 * Event-sensitive averages must depend only on their current window. Carrying
 * an earlier rounded sum can invent a crossing or retain an expired overflow.
 * Sum chronologically afresh; a missing or overflowing window stays absent.
 */
export function windowSum(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const value = values[j];
      if (!Number.isFinite(value)) { sum = NaN; break; }
      sum += value;
    }
    if (Number.isFinite(sum)) out[i] = sum;
  }
  return out;
}

export function windowMean(values: readonly number[], period: number): number[] {
  return windowSum(values, period).map((sum) => sum / period);
}
