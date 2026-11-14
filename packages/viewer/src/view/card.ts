import { categoryLabel, type Model, percentileRank } from "../data/model";
import type { Formatter } from "../lib/format";
import type { Mapping } from "../presets/index";

export interface CardRow {
  label: string;
  value: string;
  /** Where the value stands in this city, 0..1 (a small scale marker). */
  marker?: number;
  /** Why a value is unavailable, or a short remark. */
  note?: string;
}

export interface FileCard {
  kind: "file";
  title: string;
  folder: string;
  language: string;
  isTest: boolean;
  /** Mapped channels: ground area, height, color. */
  channels: CardRow[];
  metrics: CardRow[];
  flags: string[];
  hint: string;
}

export interface FolderCard {
  kind: "folder";
  title: string;
  path: string;
  rows: CardRow[];
  worst: Array<{ path: string; value: string }>;
}

/** Other key metrics shown on the card when the snapshot has them. */
export const KEY_METRICS = [
  "rloc",
  "mcc",
  "functions",
  "max_function_complexity",
  "max_nesting_level",
  "imports_in",
  "imports_out",
  "cohesion_groups",
  "recent_commits",
  "fix_commits",
  "main_agent",
] as const;

export function metricRow(
  model: Model,
  metricId: string,
  values: Record<string, number>,
  fmt: Formatter,
): CardRow | undefined {
  const metric = model.metrics.get(metricId);
  if (!metric) return undefined;
  const value = values[metricId];
  if (value === undefined) return { label: metric.label, value: "n/a", note: metric.limits };
  const stats = model.stats.get(metricId);
  if (metric.kind === "category")
    return { label: metric.label, value: categoryLabel(model, metricId, value) };
  const unit = metric.unit && metric.unit !== "flag" ? ` ${metric.unit}` : "";
  return {
    label: metric.label,
    value: `${fmt.number(value)}${unit}`,
    marker: stats ? percentileRank(stats, value) : undefined,
  };
}

export function fileCard(model: Model, index: number, mapping: Mapping, fmt: Formatter): FileCard {
  const file = model.files[index];
  if (!file) throw new Error(`No file at index ${index}`);
  const channels: CardRow[] = [];
  const roles: Array<[string, string | null]> = [
    ["Ground area", mapping.area],
    ["Height", mapping.height],
    ["Color", mapping.color],
    ["Twist", mapping.twist],
  ];
  for (const [role, id] of roles) {
    if (!id) continue;
    const row = metricRow(model, id, file.values, fmt);
    if (row) channels.push({ ...row, label: `${role}: ${row.label}` });
  }
  const mapped = new Set([mapping.area, mapping.height, mapping.color, mapping.twist]);
  const metrics = KEY_METRICS.filter((id) => !mapped.has(id))
    .map((id) => metricRow(model, id, file.values, fmt))
    .filter((r): r is CardRow => r !== undefined);
  const languageValue = file.values.language;
  return {
    kind: "file",
    title: file.name,
    folder: file.dir === "" ? "(root)" : file.dir,
    language: languageValue === undefined ? "unknown" : categoryLabel(model, "language", languageValue),
    isTest: file.isTest,
    channels,
    metrics,
    flags: [],
    hint: "Click for details",
  };
}

export function folderCard(model: Model, path: string, fmt: Formatter, worstMetric = "mcc"): FolderCard {
  const folder = model.folders.get(path);
  if (!folder) throw new Error(`No folder "${path}"`);
  const worst = folder.files
    .map((i) => model.files[i])
    .filter((f): f is NonNullable<typeof f> => f !== undefined && f.values[worstMetric] !== undefined)
    .sort(
      (a, b) =>
        (b.values[worstMetric] as number) - (a.values[worstMetric] as number) || (a.path < b.path ? -1 : 1),
    )
    .slice(0, 3)
    .map((f) => ({ path: f.path, value: fmt.number(f.values[worstMetric] as number) }));
  const rows: CardRow[] = [
    { label: "Files", value: fmt.integer(folder.files.length) },
    { label: "Real lines", value: fmt.integer(folder.rloc) },
  ];
  const cohesionInfo = model.metrics.get("folder_cohesion");
  if (cohesionInfo) {
    const cohesion = folder.values.folder_cohesion;
    const stats = model.folderStats.get("folder_cohesion");
    rows.push(
      cohesion === undefined
        ? { label: cohesionInfo.label, value: "n/a", note: "Needs at least 5 import links." }
        : {
            label: cohesionInfo.label,
            value: fmt.number(cohesion),
            marker: stats ? percentileRank(stats, cohesion) : undefined,
          },
    );
  }
  return {
    kind: "folder",
    title: folder.name === "" || path === "" ? "(root)" : folder.name,
    path: path === "" ? "(root)" : path,
    rows,
    worst,
  };
}
