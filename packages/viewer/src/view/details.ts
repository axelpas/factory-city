import { categoryLabel, type Model } from "../data/model";
import type { Formatter } from "../lib/format";
import type { Mapping } from "../presets/index";
import { type CardRow, metricRow } from "./card";
import { bucketRows, groupsOf } from "./detail-rows";
import type { Bounded } from "./marker";

export interface DetailRow {
  id: string;
  label: string;
  value: string;
  /** Share of the files with a strictly lower value, 0..1; absent when the value is common or the metric is a category. */
  rank?: number;
  /** Definition and limits of the metric. */
  title: string;
}

export interface DetailGroup {
  name: string;
  rows: DetailRow[];
  /** Every value is zero: the group folds into one line. */
  allZero: boolean;
  /** What to say instead of a list of zeros. */
  zeroText: string;
}

export interface FileDetails {
  title: string;
  path: string;
  language: string;
  isTest: boolean;
  /** The mapped channels, first. */
  channels: CardRow[];
  /** Dimensions on which the file is rated high or very high, worst first: "Complexity: very high (28)". */
  risks: string[];
  groups: DetailGroup[];
  /** Metrics this file has no value for, with the reason: listed together, never as zero. */
  unavailable: Array<{ label: string; note: string }>;
}

const LEVELS = ["high", "very high"] as const;

/** The risk dimensions on which a file is rated high or very high, worst first. */
export function risksOf(
  model: Model,
  values: Record<string, number>,
  dimensions: ReadonlyArray<Bounded & { label?: string }>,
  fmt: Formatter,
): string[] {
  const found: Array<{ level: number; text: string }> = [];
  for (const d of dimensions) {
    const value = values[d.metric];
    const high = d.bounds[1];
    const veryHigh = d.bounds[2];
    if (value === undefined || high === undefined || value <= high) continue;
    const level = veryHigh !== undefined && value > veryHigh ? 1 : 0;
    const label = d.label ?? model.metrics.get(d.metric)?.label ?? d.metric;
    found.push({ level, text: `${label}: ${LEVELS[level]} (${fmt.number(value)})` });
  }
  return found.sort((a, b) => b.level - a.level || (a.text < b.text ? -1 : 1)).map((f) => f.text);
}

/** The mapped channels (area, height, color, marker) with their values, for the metrics that have a row. */
function channelRows(
  model: Model,
  file: Model["files"][number],
  mapping: Mapping,
  fmt: Formatter,
): CardRow[] {
  const channels: CardRow[] = [];
  for (const [role, id] of [
    ["Area", mapping.area],
    ["Height", mapping.height],
    ["Color", mapping.color],
    ["Marker", mapping.marker?.metric ?? null],
  ] as const) {
    if (!id || id.startsWith("@")) continue;
    const row = metricRow(model, id, file.values, fmt);
    if (row) channels.push({ ...row, label: `${role}: ${row.label}` });
  }
  return channels;
}

/**
 * Everything known about a file, ordered for reading: the mapped channels, then the metrics by family. A
 * family whose values are all zero folds into one line; a metric without a value is listed apart with the
 * reason, never as zero.
 */
export function fileDetails(
  model: Model,
  index: number,
  mapping: Mapping,
  fmt: Formatter,
  dimensions: ReadonlyArray<Bounded & { label?: string }> = [],
): FileDetails {
  const file = model.files[index];
  if (!file) throw new Error(`No file at index ${index}`);
  const { buckets, zeros, unavailable } = bucketRows(model, file, fmt);
  const language = file.values.language;
  return {
    title: file.name,
    path: file.path,
    language: language === undefined ? "Unknown language" : categoryLabel(model, "language", language),
    isTest: file.isTest,
    channels: channelRows(model, file, mapping, fmt),
    risks: risksOf(model, file.values, dimensions, fmt),
    groups: groupsOf(buckets, zeros),
    unavailable: unavailable.sort((a, b) => (a.label < b.label ? -1 : 1)),
  };
}
