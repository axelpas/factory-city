import type { Model } from "../data/model";

/**
 * The marker channel: the files above a threshold on a metric carry a mark on their roof. A yes-or-no cue,
 * read at a glance, where a fourth quantity on the same building would not be.
 */
export interface Marker {
  metric: string;
  /** A file is marked when its value is above this. */
  threshold: number;
  /** Where the threshold comes from: the "high" bound of a risk dimension, the top tenth, or the user. */
  source: "risk" | "top" | "chosen";
}

/** A risk dimension, as far as the marker needs it: the bounds between low, moderate, high and very high. */
export interface Bounded {
  metric: string;
  bounds: readonly number[];
}

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
  if (chosen !== undefined && Number.isFinite(chosen)) return { metric, threshold: chosen, source: "chosen" };
  const high = dimensions.find((d) => d.metric === metric)?.bounds[1];
  if (high !== undefined) return { metric, threshold: high, source: "risk" };
  const sorted = model.stats.get(metric)?.sorted;
  if (!sorted || sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * (1 - MARKER_TOP_SHARE)));
  return { metric, threshold: sorted[index] as number, source: "top" };
}

/** An unavailable value is never marked. */
export function isMarked(value: number | undefined, marker: Marker | null | undefined): boolean {
  return marker !== null && marker !== undefined && value !== undefined && value > marker.threshold;
}

export function markedCount(model: Model, marker: Marker): number {
  let n = 0;
  for (const file of model.files) if (isMarked(file.values[marker.metric], marker)) n++;
  return n;
}
