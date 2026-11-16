import type { Layout } from "@factory-city/layout";
import type { TimelineData } from "../data/timeline";
import { makePathFilter } from "../lib/glob";
import type { Mapping } from "../presets/index";
import type { Theme } from "../themes/index";
import { CHANGE, changePlacements } from "./change";
import { parseHex } from "./color";
import { computePlacements, type Placement } from "./placements";
import { buildState } from "./state";
import { blockSize, voxelize } from "./voxel";

export type TestsMode = "show" | "dim" | "hide";

/** What decides how the buildings of a frame are drawn. */
export interface FrameInputs {
  data: TimelineData;
  layout: Layout;
  mapping: Mapping;
  /** The filter by path or glob. */
  search: string;
  tests: TestsMode;
}

type Frame = TimelineData["frames"][number];

/** The placement of each union file in a frame. The Change preset also draws the files the frame removed. */
function placementsOf(
  s: FrameInputs,
  theme: Theme,
  frameIndex: number,
  frame: Frame,
): Array<Placement | undefined> {
  if (s.mapping.color === CHANGE) {
    const union = changePlacements(s.data, frameIndex, s.layout, s.mapping, theme).placements;
    return s.data.paths.map((_, u) => union[u]);
  }
  const own = computePlacements(frame.model, s.layout, s.mapping, theme).placements;
  return s.data.paths.map((_, u) => {
    const m = frame.modelIndex[u] as number;
    return m < 0 ? undefined : own[m];
  });
}

/** The files the filter dims or hides: those outside the search, and the tests when asked. */
function filtered(s: FrameInputs, frame: Frame, previous: Frame | undefined) {
  const match = makePathFilter(s.search);
  const dimmed = new Set<number>();
  const hidden = new Set<number>();
  s.data.paths.forEach((path, u) => {
    const m = frame.modelIndex[u] as number;
    const file = m >= 0 ? frame.model.files[m] : previous?.model.files[previous.modelIndex[u] as number];
    if (match && !match(path)) dimmed.add(u);
    if (file?.isTest && s.tests === "dim") dimmed.add(u);
    if (file?.isTest && s.tests === "hide") hidden.add(u);
  });
  return { dimmed, hidden };
}

/** The files the frame added or changed, which light up. */
function touchedBy(s: FrameInputs, frame: Frame, frameIndex: number): Set<number> {
  const touched = new Set<number>();
  if (!frame.info || frameIndex === 0) return touched;
  for (const path of [...frame.info.added, ...frame.info.modified]) {
    const u = s.data.pathIndex.get(path);
    if (u !== undefined) touched.add(u);
  }
  return touched;
}

/** A theme made of blocks draws whole cubes: heights and footprints snap, exact values stay in the card. */
function snapped(s: FrameInputs, theme: Theme, placements: Array<Placement | undefined>) {
  const block = blockSize(theme, s.layout.width);
  if (block === undefined) return placements;
  return placements.map((p, u) => {
    const rect = p ? s.layout.files.get(s.data.paths[u] ?? "") : undefined;
    return p && rect ? voxelize(p, rect, block, theme) : p;
  });
}

/** The buildings of a frame as the animator wants them: one row of numbers per union file. */
export function frameState(s: FrameInputs, theme: Theme, frameIndex: number): Float32Array {
  const frame = s.data.frames[frameIndex];
  if (!frame) return new Float32Array(0);
  const previous = frameIndex > 0 ? s.data.frames[frameIndex - 1] : undefined;
  const { dimmed, hidden } = filtered(s, frame, previous);
  return buildState(s.data.paths, s.layout, snapped(s, theme, placementsOf(s, theme, frameIndex, frame)), {
    dimmed,
    hidden,
    touched: touchedBy(s, frame, frameIndex),
    dimColor: parseHex(theme.colors.dim ?? ""),
  });
}
