import type { Layout, Rect } from "@factory-city/layout";
import { categoryLabel, type Model } from "../data/model";
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

export function computePlacements(
  model: Model,
  layout: Layout,
  mapping: Mapping,
  theme: Theme,
): { placements: Array<Placement | undefined>; legend: ColorLegend } {
  const heightStats = model.stats.get(mapping.height);
  const heightScale = heightStats ? makeScale(heightStats, mapping.scale, mapping.clampP99) : () => 0.5;
  const maxHeight = theme.heightScale * layout.width;
  const sequential = theme.ramps.sequential.map(parseHex);
  const building = parseHex(theme.colors.building as string);
  const unavailable = parseHex(theme.colors.unavailable as string);

  const colorMetric = mapping.color ? model.metrics.get(mapping.color) : undefined;
  const colorStats = colorMetric ? model.stats.get(colorMetric.id) : undefined;
  const colorScale =
    colorStats && colorMetric?.kind !== "category" ? makeScale(colorStats, "linear", true) : undefined;
  const cats = colorMetric?.kind === "category" ? categoryPalette(model, colorMetric.id, theme) : undefined;

  const placements = model.files.map((file): Placement | undefined => {
    const rect = layout.files.get(file.path);
    if (!rect) return undefined;
    const { x, z } = parcelCenter(rect);
    const inset = PARCEL_INSET;
    const hv = file.values[mapping.height];
    const footprint = { w: rect.w * (1 - inset * 2), d: rect.h * (1 - inset * 2) };
    const markerValue = mapping.marker ? file.values[mapping.marker.metric] : undefined;
    const marked = mapping.marker ? isMarked(markerValue, mapping.marker) : false;
    const roofSteepness = markStrength(markerValue, mapping.marker);
    let color = building;
    let ramp: number | undefined;
    let colorUnavailable = false;
    let roofMark = 0;
    if (colorMetric) {
      const cv = file.values[colorMetric.id];
      if (cv === undefined) {
        color = unavailable;
        colorUnavailable = true;
      } else if (cats) {
        const slot = cats.slots.get(cv);
        color = slot === undefined ? cats.other : (cats.palette[slot] as Rgb);
        roofMark = slot === undefined ? 1 : slot / Math.max(cats.palette.length, 1);
      } else if (colorScale) {
        ramp = colorScale(cv);
        color = rampColor(sequential, ramp);
      }
    }
    return {
      x,
      z,
      w: footprint.w,
      d: footprint.d,
      marked,
      markStrength: roofSteepness,
      h: hv === undefined ? MIN_HEIGHT : MIN_HEIGHT + heightScale(hv) * maxHeight,
      baseY: plinthTop(folderDepth(file.dir)),
      color,
      ramp,
      roofMark,
      heightUnavailable: hv === undefined,
      colorUnavailable,
    };
  });

  let legend: ColorLegend = { kind: "none", metric: null };
  if (cats && colorMetric) {
    const entries = [...cats.slots.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([value, slot]) => ({
        label: categoryLabel(model, colorMetric.id, value),
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
    legend = { kind: "categorical", metric: colorMetric.id, categories: entries };
  } else if (colorMetric && colorStats) {
    legend = {
      kind: "sequential",
      metric: colorMetric.id,
      min: colorStats.min,
      max: colorStats.p99,
      clamped: colorStats.p99 < colorStats.max,
    };
  }
  return { placements, legend };
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
