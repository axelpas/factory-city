export interface MetricStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p99: number;
  /** Ascending. */
  sorted: number[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function statsOf(values: number[]): MetricStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p50: quantile(sorted, 0.5),
    p99: quantile(sorted, 0.99),
    sorted,
  };
}

/** Fraction of values that are at or below `value` (0..1). */
export function percentileRank(stats: MetricStats, value: number): number {
  const { sorted } = stats;
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}
