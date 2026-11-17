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
  /** The score with the security dimension left out, when the code could be rated on it. */
  scoreWithoutSecurityText?: string;
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

/** The score without the security signals and the scanner findings, as text, when they entered the rating of this frame. */
function withoutSecurity(
  report: Report,
  current: FrameHealth | undefined,
  rows: readonly ProfileRow[],
  fmt: Formatter,
): string | undefined {
  const value = current?.scoreWithoutSecurity ?? (current ? undefined : report.health.scoreWithoutSecurity);
  return value !== undefined && rows.some((r) => r.id === "security" || r.id === "scanner")
    ? fmt.score(value)
    : undefined;
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

/** The optional field, only when there is a value. */
function withText(text: string | undefined): { scoreWithoutSecurityText?: string } {
  return text === undefined ? {} : { scoreWithoutSecurityText: text };
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

/** The hotspots and hidden links: the details are those of the latest frame, so other frames show paths only. */
function hotspotFields(report: Report, current: FrameHealth | undefined, isLatest: boolean) {
  return {
    hotspots: isLatest ? report.hotspots : [],
    hotspotPaths: current?.hotspots ?? report.hotspots.slice(0, 5).map((h) => h.path),
    hotspotsFromLatest: !isLatest,
    hiddenLinks: isLatest ? report.hiddenLinks : [],
  };
}

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
    ...withText(withoutSecurity(report, current, rows, fmt)),
    notice: report.notice,
    trend: isTimeline ? frames.map((h) => h?.score ?? Number.NaN) : [],
    profile: rows,
    unavailable,
    ...hotspotFields(report, current, isLatest),
    ...(movement ? { movement } : {}),
  };
}

export { scoreAt, trendPoints } from "./score-trend";
