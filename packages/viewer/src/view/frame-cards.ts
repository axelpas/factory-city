import type { Model } from "../data/model";
import type { TimelineData } from "../data/timeline";
import type { Formatter } from "../lib/format";
import type { Mapping } from "../presets/index";
import type { CardRow } from "./card";

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
