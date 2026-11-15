import type { Rect } from "@factory-city/layout";
import type { Theme } from "../themes/index";
import { parseHex, rampColor } from "./color";
import type { Placement } from "./placements";

/** Side of one block in map units, for a theme drawn as stacks of cubes; undefined for other themes. */
export function blockSize(theme: Theme, mapSize: number): number | undefined {
  return theme.renderer === "voxel" ? mapSize * (theme.effects?.blockSize ?? 0.008) : undefined;
}

/**
 * Turns a building into a stack of whole blocks: the height is rounded to whole blocks (at least one), the
 * footprint snaps to whole cells, and the color metric is shown in a few discrete steps. The building never
 * leaves its parcel: a parcel smaller than one cell keeps the footprint it had. Exact values stay in the card.
 */
export function voxelize(p: Placement, parcel: Rect, block: number, theme: Theme): Placement {
  const snap = (size: number) => (size >= block ? Math.floor(size / block + 1e-9) * block : size);
  const w = snap(p.w);
  const d = snap(p.d);
  // stay inside the parcel after snapping the corner to the grid
  const corner = (center: number, size: number, min: number, max: number) => {
    if (size < block) return center - size / 2;
    const snapped = Math.round((center - size / 2) / block) * block;
    return Math.min(Math.max(snapped, min), max - size);
  };
  const x0 = corner(p.x, w, parcel.x, parcel.x + parcel.w);
  const z0 = corner(p.z, d, parcel.y, parcel.y + parcel.h);
  const steps = theme.effects?.colorSteps;
  let ramp = p.ramp;
  let color = p.color;
  if (ramp !== undefined && steps && steps > 1) {
    const step = Math.min(Math.floor(ramp * steps), steps - 1);
    ramp = step / (steps - 1);
    color = rampColor(theme.ramps.sequential.map(parseHex), ramp);
  }
  return {
    ...p,
    x: x0 + w / 2,
    z: z0 + d / 2,
    w,
    d,
    h: Math.max(1, Math.round(p.h / block)) * block,
    twist: 0,
    ramp,
    color,
  };
}

/** How many blocks a building of this height is. */
export function blocksHigh(height: number, block: number): number {
  return Math.max(1, Math.round(height / block));
}

/**
 * What one block is worth, in plain language. With a linear scale every block stands for the same amount;
 * with another scale the legend says how tall the largest value is.
 */
export function blockLegend(
  label: string,
  stats: { min: number; max: number; p99: number } | undefined,
  scale: "linear" | "sqrt" | "log",
  clampP99: boolean,
  maxHeight: number,
  block: number,
  number: (n: number) => string,
): string {
  if (!stats) return "Heights are rounded to whole blocks.";
  const top = clampP99 ? Math.max(stats.p99, stats.min) : stats.max;
  const blocks = Math.max(1, Math.round(maxHeight / block));
  const name = label.toLowerCase();
  if (scale === "linear" && top > stats.min) {
    return `Heights are rounded to whole blocks: one block = ${number((top - stats.min) / blocks)} of ${name}.`;
  }
  return `Heights are rounded to whole blocks on a ${scale} scale: ${number(blocks)} blocks = ${number(top)} of ${name}.`;
}
