import { categoryLabel, type Model, percentileRank } from "../data/model";
import type { Formatter } from "../lib/format";
import type { Mapping } from "../presets/index";
import { risksOf } from "./details";
import type { Bounded } from "./marker";

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
  /** Mapped channels: area, height, color, and the marker when one is set. */
  channels: CardRow[];
  /** At most two other facts, chosen because they stand out: a risk threshold exceeded, the main author. */
  facts: CardRow[];
  hint: string;
}

export interface FolderCard {
  kind: "folder";
  title: string;
  path: string;
  rows: CardRow[];
  worst: Array<{ path: string; value: string }>;
}

/** The card is a glance: it never shows more than this many facts beside the mapped channels. */
export const MAX_CARD_FACTS = 2;

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
  return {
    label: metric.label,
    value: fmt.quantity(value, metric.unit),
    // a marker says where the value stands in the city: meaningless when every file has the same value
    marker: stats && stats.max > stats.min ? percentileRank(stats, value) : undefined,
  };
}

/** The rows of the channels the city shows: area, height, color and marker, each with its value. */
function channelRows(
  model: Model,
  mapping: Mapping,
  values: Record<string, number>,
  fmt: Formatter,
): CardRow[] {
  const roles: Array<[string, string | null]> = [
    ["Area", mapping.area],
    ["Height", mapping.height],
    ["Color", mapping.color],
    ["Marker", mapping.marker?.metric ?? null],
  ];
  const rows: CardRow[] = [];
  for (const [role, id] of roles) {
    if (!id || id.startsWith("@")) continue;
    const row = metricRow(model, id, values, fmt);
    if (row) rows.push({ ...row, label: `${role}: ${row.label}` });
  }
  return rows;
}

/** What stands out: the risk levels exceeded, worst first, then who wrote most of the file. */
function factRows(
  model: Model,
  values: Record<string, number>,
  dimensions: ReadonlyArray<Bounded & { label?: string }>,
  fmt: Formatter,
): CardRow[] {
  const facts: CardRow[] = risksOf(model, values, dimensions, fmt).map((text) => {
    const cut = text.indexOf(": ");
    return { label: text.slice(0, cut), value: text.slice(cut + 2) };
  });
  const author = values.main_agent === undefined ? undefined : metricRow(model, "main_agent", values, fmt);
  if (author) facts.push(author);
  return facts;
}

export function fileCard(
  model: Model,
  index: number,
  mapping: Mapping,
  fmt: Formatter,
  dimensions: ReadonlyArray<Bounded & { label?: string }> = [],
): FileCard {
  const file = model.files[index];
  if (!file) throw new Error(`No file at index ${index}`);
  const channels = channelRows(model, mapping, file.values, fmt);
  const facts = factRows(model, file.values, dimensions, fmt);
  const languageValue = file.values.language;
  return {
    kind: "file",
    title: file.name,
    folder: file.dir === "" ? "(root)" : file.dir,
    language:
      languageValue === undefined ? "Unknown language" : categoryLabel(model, "language", languageValue),
    isTest: file.isTest,
    channels,
    facts: facts.slice(0, MAX_CARD_FACTS),
    hint: "Click for all its metrics",
  };
}

type Folder = NonNullable<ReturnType<Model["folders"]["get"]>>;

/** The three files of a folder with the highest value of a metric, worst first. */
function worstFiles(model: Model, folder: Folder, metric: string, fmt: Formatter) {
  return folder.files
    .map((i) => model.files[i])
    .filter((f): f is NonNullable<typeof f> => f !== undefined && f.values[metric] !== undefined)
    .sort((a, b) => (b.values[metric] as number) - (a.values[metric] as number) || (a.path < b.path ? -1 : 1))
    .slice(0, 3)
    .map((f) => ({ path: f.path, value: fmt.number(f.values[metric] as number) }));
}

/** The numbers a folder card lists: files, real lines and, when measured, the cohesion of the folder. */
function folderRows(model: Model, folder: Folder, fmt: Formatter): CardRow[] {
  const rows: CardRow[] = [
    { label: "Files", value: fmt.integer(folder.files.length) },
    { label: "Real lines", value: fmt.integer(folder.rloc) },
  ];
  const info = model.metrics.get("folder_cohesion");
  if (!info) return rows;
  const cohesion = folder.values.folder_cohesion;
  const stats = model.folderStats.get("folder_cohesion");
  rows.push(
    cohesion === undefined
      ? { label: info.label, value: "n/a", note: "Needs at least 5 import links." }
      : {
          label: info.label,
          value: fmt.number(cohesion),
          marker: stats ? percentileRank(stats, cohesion) : undefined,
        },
  );
  return rows;
}

export function folderCard(model: Model, path: string, fmt: Formatter, worstMetric = "mcc"): FolderCard {
  const folder = model.folders.get(path);
  if (!folder) throw new Error(`No folder "${path}"`);
  const worst = worstFiles(model, folder, worstMetric, fmt);
  const rows = folderRows(model, folder, fmt);
  return {
    kind: "folder",
    title: folder.name === "" || path === "" ? "(root)" : folder.name,
    path: path === "" ? "(root)" : path,
    rows,
    worst,
  };
}
