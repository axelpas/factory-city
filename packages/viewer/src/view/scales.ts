import type { MetricStats } from "../data/model";

export type ScaleKind = "linear" | "sqrt" | "log";
export const SCALE_KINDS: readonly ScaleKind[] = ["linear", "sqrt", "log"];

function transform(kind: ScaleKind, x: number): number {
  if (kind === "sqrt") return Math.sqrt(x);
  if (kind === "log") return Math.log1p(x);
  return x;
}

/** Maps a metric value to 0..1. With `clampP99`, outliers above the 99th percentile saturate. */
export function makeScale(stats: MetricStats, kind: ScaleKind, clampP99: boolean): (value: number) => number {
  const lo = stats.min;
  const hi = clampP99 ? Math.max(stats.p99, lo) : stats.max;
  if (hi <= lo) return () => 0.5;
  const top = transform(kind, hi - lo);
  return (value) => {
    const x = Math.min(Math.max(value, lo), hi) - lo;
    return transform(kind, x) / top;
  };
}
