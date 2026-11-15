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

/** The card of a frame on the timeline bar: issue, kind, estimate against actual scope, quality, agent, CI, cost. */
export function frameCardRows(frame: Frame, fmt: Formatter): CardRow[] {
  const m = frame.metrics;
  const rows: CardRow[] = [{ label: "Kind", value: KIND_NAMES[frame.kind] ?? frame.kind }];
  const scope = `${fmt.integer(m.files_touched)} file${m.files_touched === 1 ? "" : "s"}, ${fmt.integer(m.lines_added + m.lines_deleted)} lines`;
  rows.push({
    label: m.estimate ? `Estimate ${m.estimate}, actual scope` : "Scope",
    value: m.scope_gap ? `${scope} (well beyond)` : scope,
  });
  if (m.quality_delta !== undefined) {
    const d = m.quality_delta;
    rows.push({
      label: "Score",
      value: d === 0 ? "unchanged" : `${d > 0 ? "+" : "−"}${fmt.number(Math.abs(d), 1)}`,
    });
  }
  if (m.agent || m.model)
    rows.push({ label: "Agent, model", value: [m.agent, m.model].filter(Boolean).join(", ") });
  if (m.outcome)
    rows.push({
      label: "Outcome",
      value:
        m.attempts && m.attempts > 1 ? `${m.outcome} after ${fmt.integer(m.attempts)} attempts` : m.outcome,
    });
  if (m.ci_attempts !== undefined) rows.push({ label: "CI attempts", value: fmt.integer(m.ci_attempts) });
  if (m.cycle_time_hours !== undefined)
    rows.push({ label: "Cycle time", value: `${fmt.number(m.cycle_time_hours, 1)} h` });
  if (m.cost !== undefined)
    rows.push({ label: "Cost", value: `${fmt.number(m.cost)}${m.currency ? ` ${m.currency}` : ""}` });
  if (m.rework_after !== undefined)
    rows.push({ label: "Rework afterwards", value: fmt.percent(m.rework_after), note: "retrospective" });
  else if (m.rework_after_pending)
    rows.push({ label: "Rework afterwards", value: "n/a", note: "Pending: needs 14 days of later history." });
  if (m.caused_fixes)
    rows.push({
      label: "Fixes caused",
      value: fmt.integer(m.caused_fixes),
      note: "experimental, retrospective",
    });
  return rows;
}
