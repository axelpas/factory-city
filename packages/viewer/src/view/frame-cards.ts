import type { Model } from "../data/model";
import type { TimelineData } from "../data/timeline";
import type { Formatter } from "../lib/format";
import type { Mapping } from "../presets/index";
import type { CardRow } from "./card";

export function frameName(data: TimelineData, frame: number): string {
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

/** The lines the frame added and deleted in the file, when it changed any. */
function linesRow(current: TimelineData["frames"][number], path: string, fmt: Formatter) {
  const lines = current.info?.lines[path];
  if (!lines || (lines[0] <= 0 && lines[1] <= 0)) return [];
  return [{ label: "Lines, this frame", value: `+${fmt.integer(lines[0])} −${fmt.integer(lines[1])}` }];
}

/** The rows about the file itself: added in this frame, and the change of the mapped values. */
function valueRows(
  data: TimelineData,
  frame: number,
  union: number,
  mapping: Mapping,
  fmt: Formatter,
): CardRow[] {
  const current = data.frames[frame] as TimelineData["frames"][number];
  const now = current.model.files[current.modelIndex[union] as number];
  const previous = frame > 0 ? data.frames[frame - 1] : undefined;
  const before = previous ? previous.model.files[previous.modelIndex[union] as number] : undefined;
  if (!now) return [];
  if (previous && !before) return [{ label: "This frame", value: "added the file" }];
  return before ? mappedChanges(current.model, before.values, now.values, mapping, fmt) : [];
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
  const first = data.firstFrame[union] as number;
  return [
    ...valueRows(data, frame, union, mapping, fmt),
    ...linesRow(current, data.paths[union] as string, fmt),
    ...(first >= 0 ? [{ label: "Appeared at", value: frameName(data, first) }] : []),
  ];
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

export { type LotCard, lotCard } from "./lot-card";
