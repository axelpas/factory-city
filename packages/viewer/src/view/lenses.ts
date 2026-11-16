import type { Frame } from "@factory-city/schema";
import type { Formatter } from "../lib/format";
import type { CardRow } from "./card";

export interface Marker {
  type: "ci" | "scope" | "quality";
  title: string;
}

/** Small markers under a tick: a failed first CI run, a scope gap, a lower score. */
export function frameMarkers(frame: Frame | undefined): Marker[] {
  if (!frame) return [];
  const m = frame.metrics;
  const out: Marker[] = [];
  if (m.first_pass_green === false) out.push({ type: "ci", title: "The first CI run failed" });
  if (m.scope_gap === true) out.push({ type: "scope", title: "Went well beyond its estimate" });
  if ((m.quality_delta ?? 0) < 0) out.push({ type: "quality", title: "Lowered the score" });
  return out;
}

export interface Series {
  id: string;
  label: string;
  /** What is missing when the series cannot be drawn. */
  needs: string;
  pick(frame: Frame, index: number, frames: ReadonlyArray<Frame | undefined>): number | undefined;
}

/** The series the trend strip can follow. */
export const SERIES: readonly Series[] = [
  { id: "files", label: "Files", needs: "a timeline", pick: (f) => f.totals.files },
  { id: "rloc", label: "Real lines", needs: "a timeline", pick: (f) => f.totals.rloc },
  { id: "complexity", label: "Complexity", needs: "a timeline", pick: (f) => f.totals.mcc },
  { id: "score", label: "Score", needs: "a code-health score per frame", pick: (f) => f.health?.score },
  {
    id: "rework",
    label: "Rework afterwards",
    needs: "git history, and 14 days of later history per frame",
    pick: (f) => f.metrics.rework_after,
  },
  {
    id: "fixes",
    label: "Fix share so far",
    needs: "a timeline",
    pick: (_f, index, frames) => {
      const seen = frames.slice(0, index + 1).filter((x): x is Frame => x !== undefined);
      return seen.length === 0 ? undefined : seen.filter((x) => x.kind === "fix").length / seen.length;
    },
  },
  {
    id: "ci",
    label: "CI attempts",
    needs: "CI runs on pull requests (data level 2)",
    pick: (f) => f.metrics.ci_attempts,
  },
  {
    id: "cost",
    label: "Cost",
    needs: "a facts file with a cost column (data level 3)",
    pick: (f) => f.metrics.cost,
  },
];

export interface SeriesState {
  series: Series;
  values: number[];
  /** True when at least two frames have a value: the strip can be drawn. */
  available: boolean;
}

/** The values of every series over the frames; a frame without a value holds NaN. */
export function seriesStates(frames: ReadonlyArray<Frame | undefined>): SeriesState[] {
  return SERIES.map((series) => {
    const values = frames.map((f, i) => (f ? (series.pick(f, i, frames) ?? Number.NaN) : Number.NaN));
    return { series, values, available: values.filter((v) => Number.isFinite(v)).length >= 2 };
  });
}

/** One line for the help: which lenses are hidden, and what would show them. */
export function hiddenLensesLine(states: readonly SeriesState[]): string | undefined {
  const hidden = states.filter((s) => !s.available);
  if (hidden.length === 0) return undefined;
  return `Hidden trend series: ${hidden.map((s) => `${s.series.label} (needs ${s.series.needs})`).join("; ")}.`;
}

const KIND_NAMES: Record<string, string> = {
  feature: "feature",
  fix: "fix",
  refactor: "refactor",
  chore: "chore",
  docs: "docs",
  test: "test",
  unknown: "unknown kind",
};

type Metrics = Frame["metrics"];
type RowOf = (m: Metrics, fmt: Formatter) => CardRow | undefined;

const signed = (d: number, fmt: Formatter) =>
  d === 0 ? "unchanged" : `${d > 0 ? "+" : "−"}${fmt.number(Math.abs(d), 1)}`;

const scopeRow: RowOf = (m, fmt) => {
  const scope = `${fmt.integer(m.files_touched)} file${m.files_touched === 1 ? "" : "s"}, ${fmt.integer(m.lines_added + m.lines_deleted)} lines`;
  return {
    label: m.estimate ? `Estimate ${m.estimate}, actual scope` : "Scope",
    value: m.scope_gap ? `${scope} (well beyond)` : scope,
  };
};

const outcomeRow: RowOf = (m, fmt) => {
  if (!m.outcome) return undefined;
  const after = m.attempts && m.attempts > 1 ? ` after ${fmt.integer(m.attempts)} attempts` : "";
  return { label: "Outcome", value: `${m.outcome}${after}` };
};

const reworkRow: RowOf = (m, fmt) => {
  if (m.rework_after !== undefined)
    return { label: "Rework afterwards", value: fmt.percent(m.rework_after), note: "retrospective" };
  return m.rework_after_pending
    ? { label: "Rework afterwards", value: "n/a", note: "Pending: needs 14 days of later history." }
    : undefined;
};

/** One row per fact the frame has, in the order they are shown. */
const FRAME_ROWS: readonly RowOf[] = [
  scopeRow,
  (m, fmt) =>
    m.quality_delta === undefined ? undefined : { label: "Score", value: signed(m.quality_delta, fmt) },
  (m) =>
    m.agent || m.model
      ? { label: "Agent, model", value: [m.agent, m.model].filter(Boolean).join(", ") }
      : undefined,
  outcomeRow,
  (m, fmt) =>
    m.ci_attempts === undefined ? undefined : { label: "CI attempts", value: fmt.integer(m.ci_attempts) },
  (m, fmt) =>
    m.cycle_time_hours === undefined
      ? undefined
      : { label: "Cycle time", value: `${fmt.number(m.cycle_time_hours, 1)} h` },
  (m, fmt) =>
    m.cost === undefined
      ? undefined
      : { label: "Cost", value: `${fmt.number(m.cost)}${m.currency ? ` ${m.currency}` : ""}` },
  reworkRow,
  (m, fmt) =>
    m.caused_fixes
      ? { label: "Fixes caused", value: fmt.integer(m.caused_fixes), note: "experimental, retrospective" }
      : undefined,
];

/** The card of a frame on the timeline bar: issue, kind, estimate against actual scope, quality, agent, CI, cost. */
export function frameCardRows(frame: Frame, fmt: Formatter): CardRow[] {
  const rows = FRAME_ROWS.map((row) => row(frame.metrics, fmt)).filter((r) => r !== undefined);
  return [{ label: "Kind", value: KIND_NAMES[frame.kind] ?? frame.kind }, ...rows];
}
