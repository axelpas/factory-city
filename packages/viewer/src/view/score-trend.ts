import type { Report } from "@factory-city/schema";
import type { TimelineData } from "../data/timeline";

/**
 * The score at a position of the playhead, in frames: between two frames it moves from one score to the
 * other with the picture, so that the number follows the animation. Undefined without a report.
 */
export function scoreAt(
  data: TimelineData,
  report: Report | undefined,
  position: number,
): number | undefined {
  if (!report) return undefined;
  const count = data.frames.length;
  if (count < 2) return report.health.score;
  const p = Math.min(Math.max(position, 0), count - 1);
  const i = Math.floor(p);
  const j = Math.min(i + 1, count - 1);
  const a = data.frames[i]?.info?.health?.score;
  const b = data.frames[j]?.info?.health?.score;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a + (b - a) * (p - i);
}

/** Points of a trend line in a box of the given size, skipping frames without a score. */
export function trendPoints(values: readonly number[], width: number, height: number): string {
  const known = values.filter((v) => Number.isFinite(v));
  if (known.length < 2) return "";
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  return values
    .map((v, i) =>
      Number.isFinite(v)
        ? `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`
        : "",
    )
    .filter(Boolean)
    .join(" ");
}
