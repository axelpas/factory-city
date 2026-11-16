import { categoryLabel, type Model, percentileRank } from "../data/model";
import type { TimelineData } from "../data/timeline";
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

export interface LotCard {
  kind: "lot";
  title: string;
  folder: string;
  /** Which file will stand here, or stood here, and at which frame. */
  text: string;
}

function frameName(data: TimelineData, frame: number): string {
  const info = data.frames[frame]?.info;
  return info ? `frame ${frame + 1} (${info.label})` : `frame ${frame + 1}`;
}

function signed(value: number, fmt: Formatter): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${fmt.number(Math.abs(value))}`;
}

/** The change of each mapped metric of a file since the previous frame, for the numbers that moved. */
function mappedChanges(
  model: Model,
  before: Record<string, number>,
  now: Record<string, number>,
  mapping: Mapping,
  fmt: Formatter,
): CardRow[] {
  const rows: CardRow[] = [];
  for (const id of new Set([mapping.area, mapping.height, mapping.color, mapping.marker?.metric])) {
    if (!id) continue;
    const metric = model.metrics.get(id);
    const a = before[id];
    const b = now[id];
    if (!metric || metric.kind === "category" || a === undefined || b === undefined || a === b) continue;
    rows.push({ label: `${metric.label}, this frame`, value: signed(b - a, fmt) });
  }
  return rows;
}

/** What the current frame did to a file: change of the mapped values, lines added and deleted, first appearance. */
export function frameChangeRows(
  data: TimelineData,
  frame: number,
  union: number,
  mapping: Mapping,
  fmt: Formatter,
): CardRow[] {
  const current = data.frames[frame];
  if (!current || data.frames.length < 2) return [];
  const path = data.paths[union] as string;
  const rows: CardRow[] = [];
  const now = current.model.files[current.modelIndex[union] as number];
  const previous = frame > 0 ? data.frames[frame - 1] : undefined;
  const before = previous ? previous.model.files[previous.modelIndex[union] as number] : undefined;
  if (now && previous && !before) rows.push({ label: "This frame", value: "added the file" });
  if (now && before) rows.push(...mappedChanges(current.model, before.values, now.values, mapping, fmt));
  const lines = current.info?.lines[path];
  if (lines && (lines[0] > 0 || lines[1] > 0)) {
    rows.push({ label: "Lines, this frame", value: `+${fmt.integer(lines[0])} −${fmt.integer(lines[1])}` });
  }
  const first = data.firstFrame[union] as number;
  if (first >= 0) rows.push({ label: "Appeared at", value: frameName(data, first) });
  return rows;
}

/** The nearest frame after (1) or before (-1) `from` in which the file exists, or -1. */
function nearestFrameWith(data: TimelineData, union: number, from: number, step: 1 | -1): number {
  for (let f = from + step; f >= 0 && f < data.frames.length; f += step)
    if ((data.frames[f]?.modelIndex[union] as number) >= 0) return f;
  return -1;
}

/** Card of an empty parcel: which file will stand there, or stood there, and at which frame. */
export function lotCard(data: TimelineData, frame: number, union: number): LotCard {
  const path = data.paths[union] as string;
  const cut = path.lastIndexOf("/");
  const first = data.firstFrame[union] as number;
  const last = data.lastFrame[union] as number;
  const next = nearestFrameWith(data, union, frame, 1);
  const previous = nearestFrameWith(data, union, frame, -1);
  let text: string;
  if (frame < first) text = `This file will stand here from ${frameName(data, first)}.`;
  else if (frame > last) text = `This file stood here until ${frameName(data, last)}.`;
  else if (previous >= 0 && next >= 0)
    text = `This file stood here until ${frameName(data, previous)} and comes back at ${frameName(data, next)}.`;
  else text = "This file is hidden by the current filter.";
  return { kind: "lot", title: path.slice(cut + 1), folder: cut < 0 ? "(root)" : path.slice(0, cut), text };
}

/** The last change of a file: its date, and the issue number and title when known. */
export function lastChangeRow(
  data: TimelineData,
  frame: number,
  union: number,
  fmt: Formatter,
): CardRow | undefined {
  const path = data.paths[union] as string;
  for (let f = Math.min(frame, data.frames.length - 1); f >= 0; f--) {
    const info = data.frames[f]?.info;
    if (!info) break;
    if (!info.added.includes(path) && !info.modified.includes(path)) continue;
    const what = info.issue
      ? `#${info.issue.number}${info.issue.title ? ` ${info.issue.title}` : ""}`
      : info.label;
    return { label: "Last change", value: `${fmt.date(info.date)} · ${what}` };
  }
  const current = data.frames[frame];
  const file = current?.model.files[current.modelIndex[union] as number];
  const days = file?.values.days_since_last_change;
  if (days === undefined) return undefined;
  // a snapshot carries no date of its own here: the change is told relative to it
  const value = days === 0 ? "on the snapshot's day" : `${fmt.quantity(days, "days")} before the snapshot`;
  return { label: "Last change", value };
}
