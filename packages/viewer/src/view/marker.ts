import type { Model } from "../data/model";

/**
 * The marker channel: the files above a threshold on a metric carry a pyramid roof, and the roof is the
 * steeper the higher the value: it says "above the line" at a glance and "by how much" on a second look.
 */
export interface Marker {
  metric: string;
  /** A file is marked when its value is above this. */
  threshold: number;
  /** The value from which a roof is as steep as it gets: the 99th percentile of the metric. */
  peak: number;
  /** Where the threshold comes from: the "high" bound of a risk dimension, the top tenth, or the user. */
  source: "risk" | "top" | "chosen";
}

/** A risk dimension, as far as the marker needs it: the bounds between low, moderate, high and very high. */
export interface Bounded {
  metric: string;
  bounds: readonly number[];
}

/** The share of files whose value is allowed to stand above the steepest roof: outliers do not flatten the rest. */
const PEAK_PERCENTILE = 0.99;
/** The roof of a file just above the threshold is this share of the steepest one: it must still be seen. */
export const MIN_ROOF = 0.35;

/** Without a risk dimension, the marker shows the top tenth of the files. */
export const MARKER_TOP_SHARE = 0.1;

/**
 * The marker for a metric. The threshold is the one given, else the bound above which the metric's risk
 * dimension rates a file high, else the value that leaves the top tenth of the files above it.
 */
export function resolveMarker(
  model: Model,
  metric: string,
  dimensions: readonly Bounded[] = [],
  chosen?: number,
): Marker | undefined {
  const sorted = model.stats.get(metric)?.sorted;
  const peakOf = (threshold: number): number => {
    const top = sorted?.length
      ? (sorted[Math.floor((sorted.length - 1) * PEAK_PERCENTILE)] as number)
      : threshold;
    return Math.max(top, threshold);
  };
  if (chosen !== undefined && Number.isFinite(chosen))
    return { metric, threshold: chosen, peak: peakOf(chosen), source: "chosen" };
  const high = dimensions.find((d) => d.metric === metric)?.bounds[1];
  if (high !== undefined) return { metric, threshold: high, peak: peakOf(high), source: "risk" };
  if (!sorted || sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * (1 - MARKER_TOP_SHARE)));
  const threshold = sorted[index] as number;
  return { metric, threshold, peak: peakOf(threshold), source: "top" };
}

/** An unavailable value is never marked. */
export function isMarked(value: number | undefined, marker: Marker | null | undefined): boolean {
  return marker !== null && marker !== undefined && value !== undefined && value > marker.threshold;
}

/**
 * How steep the roof of a file is, from 0 (no roof: not above the threshold, or no value) to 1 (at or above
 * the peak). Just above the threshold a roof is `MIN_ROOF` of the steepest one.
 */
export function markStrength(value: number | undefined, marker: Marker | null | undefined): number {
  if (!marker || !isMarked(value, marker)) return 0;
  const span = marker.peak - marker.threshold;
  if (span <= 0) return 1;
  const share = Math.min(1, ((value as number) - marker.threshold) / span);
  return MIN_ROOF + (1 - MIN_ROOF) * share;
}

export function markedCount(model: Model, marker: Marker): number {
  let n = 0;
  for (const file of model.files) if (isMarked(file.values[marker.metric], marker)) n++;
  return n;
}
