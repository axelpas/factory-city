import type { Layout, Rect } from "@factory-city/layout";
import type { MetricDefinition } from "@factory-city/schema/registry";
import { categoryLabel, type MetricStats, type Model } from "../data/model";
import type { Mapping } from "../presets/index";
import type { Theme } from "../themes/index";
import { parseHex, type Rgb, rampColor } from "./color";
import { isMarked, markStrength } from "./marker";
import { makeScale } from "./scales";

export const PLINTH_THICKNESS = 0.35;
/** Share of a parcel left empty around its building. */
export const PARCEL_INSET = 0.12;
const MIN_HEIGHT = 1.2;

export interface Placement {
  /** Center on the map. */
  x: number;
  z: number;
  /** Footprint. */
  w: number;
  d: number;
  /** Height above `baseY`. */
  h: number;
  baseY: number;
  color: Rgb;
  /** Position on the sequential ramp (0..1) when the color comes from a number; undefined otherwise. */
  ramp?: number;
  /** True when the file is above the marker's threshold: it carries a mark on its roof. */
  marked: boolean;
  /** Steepness of the roof, 0 to 1 (see `markStrength`). */
  markStrength: number;
  /** 0..1: which roof mark a category carries, so that color is never the only cue. */
  roofMark: number;
  /** True when the height metric has no value for this file. */
  heightUnavailable: boolean;
  colorUnavailable: boolean;
}

export interface ColorLegend {
  kind: "none" | "sequential" | "categorical";
  metric: string | null;
  /** Numeric range for sequential colors. */
  min?: number;
  max?: number;
  /** True when the top of the ramp is the 99th percentile, not the maximum. */
  clamped?: boolean;
  /** Categories in palette order, `other` last when present. */
  categories?: Array<{ label: string; color: Rgb; roofMark: number; count: number; isOther: boolean }>;
}

export function plinthTop(depth: number): number {
  return PLINTH_THICKNESS * (depth + 1);
}

export function folderDepth(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}

export function parcelCenter(rect: Rect): { x: number; z: number } {
  return { x: rect.x + rect.w / 2, z: rect.y + rect.h / 2 };
}

/** Assigns palette slots to the most frequent categories; the rest share "other". */
export function categoryPalette(model: Model, metricId: string, theme: Theme) {
  const counts = new Map<number, number>();
  for (const f of model.files) {
    const v = f.values[metricId];
    if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const palette = theme.ramps.categorical.map(parseHex);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const slots = new Map<number, number>();
  for (const [i, [value]] of ranked.slice(0, palette.length).entries()) slots.set(value, i);
  return {
    slots,
    palette,
    counts,
    other: parseHex(theme.ramps.other),
    hasOther: ranked.length > palette.length,
  };
}

type Cats = ReturnType<typeof categoryPalette>;

/** How the color of a building is decided: a category palette, a sequential scale, or nothing. */
interface ColorPlan {
  metricId: string | undefined;
  cats: Cats | undefined;
  scale: ((v: number) => number) | undefined;
  building: Rgb;
  unavailable: Rgb;
  sequential: Rgb[];
}

/** The color of a building, and what it says on its roof; a file without a value is drawn as unavailable. */
function colorOf(value: number | undefined, plan: ColorPlan) {
  const { cats, scale } = plan;
  if (plan.metricId === undefined) return { color: plan.building, roofMark: 0 };
  if (value === undefined) return { color: plan.unavailable, roofMark: 0, colorUnavailable: true };
  if (cats) {
    const slot = cats.slots.get(value);
    return {
      color: slot === undefined ? cats.other : (cats.palette[slot] as Rgb),
      roofMark: slot === undefined ? 1 : slot / Math.max(cats.palette.length, 1),
    };
  }
  if (!scale) return { color: plan.building, roofMark: 0 };
  const ramp = scale(value);
  return { color: rampColor(plan.sequential, ramp), ramp, roofMark: 0 };
}

/** What the legend says about the color: the categories with their counts, or the range of values. */
function legendOf(
  model: Model,
  metric: MetricDefinition | undefined,
  stats: MetricStats | undefined,
  cats: Cats | undefined,
): ColorLegend {
  if (!metric) return { kind: "none", metric: null };
  if (cats) {
    const entries = [...cats.slots.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([value, slot]) => ({
        label: categoryLabel(model, metric.id, value),
        color: cats.palette[slot] as Rgb,
        roofMark: slot / Math.max(cats.palette.length, 1),
        count: cats.counts.get(value) ?? 0,
        isOther: false,
      }));
    if (cats.hasOther) {
      const used = new Set(cats.slots.keys());
      const rest = [...cats.counts.entries()].filter(([v]) => !used.has(v)).reduce((n, [, c]) => n + c, 0);
      entries.push({ label: "other", color: cats.other, roofMark: 1, count: rest, isOther: true });
    }
    return { kind: "categorical", metric: metric.id, categories: entries };
  }
  if (!stats) return { kind: "none", metric: null };
  return {
    kind: "sequential",
    metric: metric.id,
    min: stats.min,
    max: stats.p99,
    clamped: stats.p99 < stats.max,
  };
}

export function computePlacements(
  model: Model,
  layout: Layout,
  mapping: Mapping,
  theme: Theme,
): { placements: Array<Placement | undefined>; legend: ColorLegend } {
  const heightStats = model.stats.get(mapping.height);
  const heightScale = heightStats ? makeScale(heightStats, mapping.scale, mapping.clampP99) : () => 0.5;
  const maxHeight = theme.heightScale * layout.width;
  const colorMetric = mapping.color ? model.metrics.get(mapping.color) : undefined;
  const colorStats = colorMetric ? model.stats.get(colorMetric.id) : undefined;
  const cats = colorMetric?.kind === "category" ? categoryPalette(model, colorMetric.id, theme) : undefined;
  const plan: ColorPlan = {
    metricId: colorMetric?.id,
    cats,
    scale: colorStats && colorMetric?.kind !== "category" ? makeScale(colorStats, "linear", true) : undefined,
    building: parseHex(theme.colors.building as string),
    unavailable: parseHex(theme.colors.unavailable as string),
    sequential: theme.ramps.sequential.map(parseHex),
  };

  const placements = model.files.map((file): Placement | undefined => {
    const rect = layout.files.get(file.path);
    if (!rect) return undefined;
    const { x, z } = parcelCenter(rect);
    const hv = file.values[mapping.height];
    const markerValue = mapping.marker ? file.values[mapping.marker.metric] : undefined;
    const look = colorOf(colorMetric ? file.values[colorMetric.id] : undefined, plan);
    return {
      x,
      z,
      w: rect.w * (1 - PARCEL_INSET * 2),
      d: rect.h * (1 - PARCEL_INSET * 2),
      marked: mapping.marker ? isMarked(markerValue, mapping.marker) : false,
      markStrength: markStrength(markerValue, mapping.marker),
      h: hv === undefined ? MIN_HEIGHT : MIN_HEIGHT + heightScale(hv) * maxHeight,
      baseY: plinthTop(folderDepth(file.dir)),
      color: look.color,
      ramp: look.ramp,
      roofMark: look.roofMark,
      heightUnavailable: hv === undefined,
      colorUnavailable: look.colorUnavailable ?? false,
    };
  });
  return { placements, legend: legendOf(model, colorMetric, colorStats, cats) };
}

/** Light tint of a district's plinth from a folder-scope metric; folders without a value keep the plain plinth. */
export function computeTints(model: Model, mapping: Mapping, theme: Theme): Map<string, Rgb> {
  const tints = new Map<string, Rgb>();
  const id = mapping.tint;
  const stats = id ? model.folderStats.get(id) : undefined;
  if (!id || !stats) return tints;
  const ramp = theme.ramps.tint.map(parseHex);
  const scale = makeScale(stats, "linear", false);
  for (const folder of model.folders.values()) {
    const v = folder.values[id];
    if (folder.depth > 0 && v !== undefined) tints.set(folder.path, rampColor(ramp, scale(v)));
  }
  return tints;
}
