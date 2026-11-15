import { categoryLabel, type MetricStats, type Model } from "../data/model";
import type { Formatter } from "../lib/format";
import type { Mapping } from "../presets/index";
import { type CardRow, metricRow } from "./card";
import type { Bounded } from "./marker";

/** Families of metrics, in the order the file details show them. Anything else goes to "Other". */
const FAMILIES: Array<{ name: string; zero: string; ids: readonly string[]; prefix?: string }> = [
  { name: "Size", zero: "An empty file.", ids: ["loc", "rloc", "comment_lines", "functions"] },
  {
    name: "Complexity",
    zero: "No branch and no nesting.",
    ids: ["mcc", "max_function_complexity", "max_nesting_level"],
  },
  {
    name: "Coupling and cohesion",
    zero: "No link with the other files.",
    ids: ["imports_out", "imports_in", "cohesion_groups", "lack_of_cohesion", "co_change_files"],
  },
  {
    name: "Shortcuts",
    zero: "No silenced check.",
    ids: ["escape_hatches", "escape_hatch_density"],
    prefix: "escape_",
  },
  { name: "Duplication", zero: "No copied line.", ids: ["duplicated_lines", "duplication_ratio"] },
  {
    name: "History",
    zero: "No change recorded.",
    ids: [
      "number_of_commits",
      "recent_commits",
      "lines_added_recent",
      "lines_deleted_recent",
      "fix_commits",
      "fix_commits_recent",
      "rework_lines",
      "rework_ratio",
      "issues_recent",
      "age_days",
      "days_since_last_change",
    ],
  },
  {
    name: "Authorship",
    zero: "No author recorded.",
    ids: ["number_of_authors", "main_agent", "main_agent_share", "cost_share"],
  },
];

/** Shown in the header, not as rows. */
const HEADER = new Set(["language", "is_test"]);
/** A value shared by more than this share of the files says nothing about where the file stands. */
const COMMON_SHARE = 0.5;

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

/** Share of files strictly below a value, and share of files with exactly that value. */
export function standing(stats: MetricStats, value: number): { below: number; same: number } {
  const { sorted } = stats;
  if (sorted.length === 0) return { below: 0, same: 0 };
  const firstAtLeast = (target: number, strict: boolean): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const v = sorted[mid] as number;
      if (strict ? v <= target : v < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const lower = firstAtLeast(value, false);
  const upper = firstAtLeast(value, true);
  return { below: lower / sorted.length, same: (upper - lower) / sorted.length };
}

function familyOf(id: string): number {
  const exact = FAMILIES.findIndex((f) => f.ids.includes(id));
  if (exact >= 0) return exact;
  return FAMILIES.findIndex((f) => f.prefix !== undefined && id.startsWith(f.prefix));
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

  const buckets = new Map<number, DetailRow[]>();
  const zeros = new Map<number, boolean>();
  const unavailable: FileDetails["unavailable"] = [];
  for (const metric of model.metrics.values()) {
    if (metric.scope !== "file" || HEADER.has(metric.id)) continue;
    const value = file.values[metric.id];
    if (value === undefined) {
      unavailable.push({ label: metric.label, note: metric.limits });
      continue;
    }
    const family = familyOf(metric.id);
    const title = `${metric.definition} ${metric.limits}`;
    let row: DetailRow;
    if (metric.kind === "category") {
      row = { id: metric.id, label: metric.label, value: categoryLabel(model, metric.id, value), title };
    } else {
      const stats = model.stats.get(metric.id);
      const stand = stats ? standing(stats, value) : undefined;
      row = {
        id: metric.id,
        label: metric.label,
        value: fmt.quantity(value, metric.unit),
        title,
        ...(stand && stand.same <= COMMON_SHARE ? { rank: stand.below } : {}),
      };
      zeros.set(family, (zeros.get(family) ?? true) && value === 0);
    }
    if (metric.kind === "category") zeros.set(family, false);
    const rows = buckets.get(family) ?? [];
    rows.push(row);
    buckets.set(family, rows);
  }

  const groups: DetailGroup[] = [];
  for (const family of [...FAMILIES.keys(), -1]) {
    const rows = buckets.get(family);
    if (!rows || rows.length === 0) continue;
    const def = FAMILIES[family];
    // the order of the family's list, then the registry's order for the rest
    const order = (id: string) => {
      const at = def?.ids.indexOf(id) ?? -1;
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    rows.sort((a, b) => order(a.id) - order(b.id));
    groups.push({
      name: def?.name ?? "Other",
      rows,
      allZero: zeros.get(family) ?? false,
      zeroText: def?.zero ?? "All zero.",
    });
  }
  const language = file.values.language;
  return {
    title: file.name,
    path: file.path,
    language: language === undefined ? "Unknown language" : categoryLabel(model, "language", language),
    isTest: file.isTest,
    channels,
    risks: risksOf(model, file.values, dimensions, fmt),
    groups,
    unavailable: unavailable.sort((a, b) => (a.label < b.label ? -1 : 1)),
  };
}
