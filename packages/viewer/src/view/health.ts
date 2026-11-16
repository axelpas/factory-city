import type { FrameHealth, Hotspot, Report, RiskDimension, RiskShare } from "@factory-city/schema";
import type { TimelineData } from "../data/timeline";
import type { Formatter } from "../lib/format";

export interface ProfileRow {
  id: string;
  label: string;
  share: RiskShare;
  /** "12% high or very high", with the share of code that could be rated. */
  text: string;
  /** Upper bounds and where they come from. */
  thresholds: string;
}

export interface HealthView {
  available: boolean;
  /** Why there is nothing to show. */
  reason?: string;
  score: number;
  scoreText: string;
  notice: string;
  /** Score of every frame, for the trend; empty for a single snapshot. */
  trend: number[];
  frame: number;
  profile: ProfileRow[];
  /** Dimensions that could not be rated, by name. */
  unavailable: string[];
  /** Full hotspots when the frame is the reported one; otherwise their paths only. */
  hotspots: Hotspot[];
  hotspotPaths: string[];
  /** True when the hotspot details describe the latest frame, not the one shown. */
  hotspotsFromLatest: boolean;
  movement?: { qualityDelta?: string; created: string[]; resolved: string[] };
  hiddenLinks: Report["hiddenLinks"];
}

function thresholds(d: RiskDimension): string {
  const [a, b, c] = d.bounds;
  const scope = d.minRloc ? ` Files of at least ${d.minRloc} real lines.` : "";
  return `Low up to ${a}, moderate up to ${b}, high up to ${c}.${scope} Source: ${d.source}.`;
}

/** The profile of the frame as rows, one per dimension that has a value, and the labels of those that do not. */
function profileRows(report: Report, profile: Report["health"]["profile"], fmt: Formatter) {
  const rows: ProfileRow[] = [];
  const unavailable: string[] = [];
  for (const d of report.dimensions) {
    const share = profile[d.id];
    if (!share) {
      unavailable.push(d.label);
      continue;
    }
    const rated = share.rated < 0.995 ? `, rated on ${fmt.percent(share.rated)} of the code` : "";
    rows.push({
      id: d.id,
      label: d.label,
      share,
      text: `${fmt.percent(share.high + share.veryHigh)} high or very high${rated}`,
      thresholds: thresholds(d),
    });
  }
  return { rows, unavailable };
}

/** What the frame did to the score and to the hotspots, against the frame before it. */
function movementOf(current: FrameHealth | undefined, previous: FrameHealth | undefined, fmt: Formatter) {
  if (!current || !previous) return undefined;
  const delta = Math.round((current.score - previous.score) * 10) / 10;
  const sign = delta > 0 ? "+" : "−";
  return {
    qualityDelta: delta === 0 ? "unchanged" : `${sign}${fmt.number(Math.abs(delta), 1)}`,
    created: current.hotspots.filter((p) => !previous.hotspots.includes(p)),
    resolved: previous.hotspots.filter((p) => !current.hotspots.includes(p)),
  };
}

const EMPTY: Omit<HealthView, "frame"> = {
  available: false,
  score: 0,
  scoreText: "",
  notice: "",
  trend: [],
  profile: [],
  unavailable: [],
  hotspots: [],
  hotspotPaths: [],
  hotspotsFromLatest: false,
  hiddenLinks: [],
};

/** Everything the Health panel shows for the frame under the playhead. */
export function healthView(
  data: TimelineData,
  frame: number,
  report: Report | undefined,
  fmt: Formatter,
): HealthView {
  if (!report)
    return {
      ...EMPTY,
      frame,
      reason:
        "No report was found next to this data. Run factory-city analyze or timeline again to write one.",
    };
  const frames = data.frames.map((f) => f.info?.health);
  const isTimeline = data.frames.length > 1;
  const current: FrameHealth | undefined = isTimeline ? frames[frame] : undefined;
  const isLatest = !isTimeline || frame === data.frames.length - 1;
  const score = current?.score ?? report.health.score;
  const { rows, unavailable } = profileRows(report, current?.profile ?? report.health.profile, fmt);
  const movement = movementOf(current, frame > 0 ? frames[frame - 1] : undefined, fmt);
  return {
    ...EMPTY,
    frame,
    available: true,
    score,
    scoreText: fmt.score(score),
    notice: report.notice,
    trend: isTimeline ? frames.map((h) => h?.score ?? Number.NaN) : [],
    profile: rows,
    unavailable,
    hotspots: isLatest ? report.hotspots : [],
    hotspotPaths: current?.hotspots ?? report.hotspots.slice(0, 5).map((h) => h.path),
    hotspotsFromLatest: !isLatest,
    hiddenLinks: isLatest ? report.hiddenLinks : [],
    ...(movement ? { movement } : {}),
  };
}

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
