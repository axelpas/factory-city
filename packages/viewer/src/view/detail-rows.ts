import type { MetricDefinition } from "@factory-city/schema/registry";
import { categoryLabel, type MetricStats, type Model } from "../data/model";
import type { Formatter } from "../lib/format";
import type { DetailGroup, DetailRow, FileDetails } from "./details";

/** Shown in the header, not as rows. */
const HEADER = new Set(["language", "is_test"]);
/** A value shared by more than this share of the files says nothing about where the file stands. */
const COMMON_SHARE = 0.5;

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

/** The row of one metric of a file: a label for a category, a quantity and where it stands for a number. */
function detailRow(model: Model, metric: MetricDefinition, value: number, fmt: Formatter): DetailRow {
  const title = `${metric.definition} ${metric.limits}`;
  if (metric.kind === "category")
    return { id: metric.id, label: metric.label, value: categoryLabel(model, metric.id, value), title };
  const stats = model.stats.get(metric.id);
  const stand = stats ? standing(stats, value) : undefined;
  return {
    id: metric.id,
    label: metric.label,
    value: fmt.quantity(value, metric.unit),
    title,
    ...(stand && stand.same <= COMMON_SHARE ? { rank: stand.below } : {}),
  };
}

/** The metrics of a file by family, which families are all zero, and the metrics without a value. */
export function bucketRows(model: Model, file: Model["files"][number], fmt: Formatter) {
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
    const isNumber = metric.kind !== "category";
    zeros.set(family, isNumber && (zeros.get(family) ?? true) && value === 0);
    buckets.set(family, [...(buckets.get(family) ?? []), detailRow(model, metric, value, fmt)]);
  }
  return { buckets, zeros, unavailable };
}

/** The families in order, each with its rows in the order of the family's list. */
export function groupsOf(buckets: Map<number, DetailRow[]>, zeros: Map<number, boolean>): DetailGroup[] {
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
  return groups;
}
