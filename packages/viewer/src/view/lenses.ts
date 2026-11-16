import type { Frame } from "@factory-city/schema";

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

export { frameCardRows } from "./frame-card-rows";
