import type { Layout } from "@factory-city/layout";
import type { TimelineData } from "../data/timeline";
import type { Mapping } from "../presets/index";
import type { Theme } from "../themes/index";
import { parseHex, rampColor } from "./color";
import { type ColorLegend, computePlacements, type Placement } from "./placements";

/** Pseudo-metric of the Change preset: what the frame did to each file since the previous frame. */
export const CHANGE = "@change";

export type ChangeStatus = "added" | "removed" | "grown" | "shrunk" | "unchanged";

export interface FileChange {
  union: number;
  status: ChangeStatus;
  /** Change of the ground-area metric (the whole value for an added or removed file). */
  delta: number;
}

/** What a frame did to every file of the timeline, measured on one metric. The first frame changes nothing. */
export function frameChanges(data: TimelineData, frame: number, metric: string): FileChange[] {
  const current = data.frames[frame];
  const previous = frame > 0 ? data.frames[frame - 1] : undefined;
  return data.paths.map((_, union): FileChange => {
    const now = current?.model.files[current.modelIndex[union] as number];
    const before = previous?.model.files[previous.modelIndex[union] as number];
    if (!previous || (!now && !before)) return { union, status: "unchanged", delta: 0 };
    const a = before?.values[metric] ?? 0;
    const b = now?.values[metric] ?? 0;
    if (!before) return { union, status: "added", delta: b };
    if (!now) return { union, status: "removed", delta: -a };
    if (b > a) return { union, status: "grown", delta: b - a };
    if (b < a) return { union, status: "shrunk", delta: b - a };
    return { union, status: "unchanged", delta: 0 };
  });
}

/** Position of a change on the diverging ramp: 0 removed, 0.5 unchanged, 1 added; grown and shrunk in between. */
export function changePosition(change: FileChange, largest: number): number {
  if (change.status === "added") return 1;
  if (change.status === "removed") return 0;
  if (change.status === "unchanged" || largest <= 0) return 0.5;
  const share = Math.min(Math.abs(change.delta) / largest, 1);
  // grown and shrunk stay clear of the ends, which mean added and removed
  return 0.5 + Math.sign(change.delta) * (0.12 + 0.26 * share);
}

/**
 * Placements of the Change preset, aligned with the timeline's files. Buildings are colored on the diverging
 * ramp; a removed file is still drawn, at the size it had, so that what disappeared can be seen.
 */
export function changePlacements(
  data: TimelineData,
  frame: number,
  layout: Layout,
  mapping: Mapping,
  theme: Theme,
): { placements: Array<Placement | undefined>; legend: ColorLegend; changes: FileChange[] } {
  const current = data.frames[frame];
  const previous = frame > 0 ? data.frames[frame - 1] : undefined;
  const plain = { ...mapping, color: null };
  const now = current ? computePlacements(current.model, layout, plain, theme).placements : [];
  const before = previous ? computePlacements(previous.model, layout, plain, theme).placements : [];
  const changes = frameChanges(data, frame, mapping.area);
  const largest = changes.reduce(
    (m, c) => (c.status === "grown" || c.status === "shrunk" ? Math.max(m, Math.abs(c.delta)) : m),
    0,
  );
  const ramp = theme.ramps.diverging.map(parseHex);
  const placements = changes.map((change): Placement | undefined => {
    const fromNow = current ? now[current.modelIndex[change.union] as number] : undefined;
    const fromBefore = previous ? before[previous.modelIndex[change.union] as number] : undefined;
    const base = fromNow ?? (change.status === "removed" ? fromBefore : undefined);
    if (!base) return undefined;
    return {
      ...base,
      color: rampColor(ramp, changePosition(change, largest)),
      ramp: undefined,
      roofMark: 0,
      colorUnavailable: false,
    };
  });
  const count = (status: ChangeStatus) => changes.filter((c) => c.status === status).length;
  const swatch = (label: string, t: number, status: ChangeStatus) => ({
    label,
    color: rampColor(ramp, t),
    roofMark: 0,
    count: count(status),
    isOther: false,
  });
  return {
    placements,
    changes,
    legend: {
      kind: "categorical",
      metric: CHANGE,
      categories: [
        swatch("added", 1, "added"),
        swatch("grown", 0.75, "grown"),
        swatch("unchanged", 0.5, "unchanged"),
        swatch("shrunk", 0.25, "shrunk"),
        swatch("removed", 0, "removed"),
      ],
    },
  };
}

/** The largest changes of a frame, biggest first. */
export function biggestChanges(changes: readonly FileChange[], top = 12): FileChange[] {
  return changes
    .filter((c) => c.status !== "unchanged")
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.union - b.union)
    .slice(0, top);
}
