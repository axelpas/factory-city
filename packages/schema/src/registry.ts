export * from "./registry/types.js";

import { METRICS_1 } from "./registry/metrics-1.js";
import { METRICS_2 } from "./registry/metrics-2.js";
import { METRICS_3 } from "./registry/metrics-3.js";
import { METRICS_4 } from "./registry/metrics-4.js";
import type { DataLevel, MetricDefinition } from "./registry/types.js";

/**
 * The metric registry: the single source for pickers, help and reports.
 * Ids follow CodeCharta names where an equivalent exists (ADR snapshot-format-cc-json).
 * It is written in parts, in the order the metrics are listed.
 */
export const METRICS: readonly MetricDefinition[] = [...METRICS_1, ...METRICS_2, ...METRICS_3, ...METRICS_4];

const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function getMetric(id: string): MetricDefinition | undefined {
  return BY_ID.get(id);
}

/** Metrics available at a given data level or below. */
export function metricsForLevel(level: DataLevel): MetricDefinition[] {
  return METRICS.filter((m) => m.level <= level);
}
