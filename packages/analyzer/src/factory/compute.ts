import type { Frame, Kpi, KpiSet } from "@factory-city/schema";
import { median } from "../collectors/delivery.js";
import { MIN_ISSUES } from "./definitions.js";

export const round = (x: number) => Math.round(x * 1000) / 1000;

/** A KPI over the issues that have the needed value; unavailable under 5 of them. */
function kpi(count: number, compute: () => number, missing: string): Kpi {
  if (count === 0) return { n: 0, reason: missing };
  if (count < MIN_ISSUES) return { n: count, reason: `needs at least ${MIN_ISSUES} issues, has ${count}` };
  return { value: round(compute()), n: count };
}

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const share = (values: readonly boolean[]) => values.filter(Boolean).length / values.length;

function defined<T>(frames: readonly Frame[], pick: (f: Frame) => T | undefined): T[] {
  return frames.map(pick).filter((v): v is T => v !== undefined);
}

/** A share measured on each issue, averaged by the lines the issue wrote. */
function weighted(frames: readonly Frame[], pick: (f: Frame) => number | undefined) {
  const lines = (f: Frame) => f.metrics.lines_written ?? 0;
  const rated = frames.filter((f) => pick(f) !== undefined && lines(f) > 0);
  const total = rated.reduce((s, f) => s + lines(f), 0);
  return {
    count: rated.length,
    value: () => rated.reduce((s, f) => s + (pick(f) as number) * lines(f), 0) / total,
  };
}

const NO_ISSUE = "no issue in this period";
const PENDING = "needs more later history";
const NEEDS_SCORES = "needs a score before and after each issue";
const NEEDS_CI = "needs CI runs on pull requests (level 2)";

/** How much the issues cost the code later: rework, shelf life, fixes they caused. */
function afterwards(
  frames: readonly Frame[],
): Pick<KpiSet, "rework_rate" | "shelf_life_30" | "shelf_life_90" | "change_fail_rate"> {
  const rework = weighted(frames, (f) => f.metrics.rework_after);
  const alive30 = weighted(frames, (f) => f.metrics.alive_30);
  const alive90 = weighted(frames, (f) => f.metrics.alive_90);
  const caused = defined(frames, (f) => f.metrics.caused_fixes);
  return {
    rework_rate: kpi(rework.count, rework.value, `${PENDING}: 14 days after each issue`),
    shelf_life_30: kpi(alive30.count, alive30.value, `${PENDING}: 30 days after each issue`),
    shelf_life_90: kpi(alive90.count, alive90.value, `${PENDING}: 90 days after each issue`),
    change_fail_rate: kpi(caused.length, () => share(caused.map((c) => c > 0)), "needs line provenance"),
  };
}

/** How the code changed in quality, and how widely an issue spreads. */
function quality(
  frames: readonly Frame[],
): Pick<KpiSet, "scatter" | "quality_drift" | "quality_lowered_share"> {
  const deltas = defined(frames, (f) => f.metrics.quality_delta);
  return {
    scatter: kpi(
      frames.length,
      () => median(frames.map((f) => f.metrics.folders_touched)) as number,
      NO_ISSUE,
    ),
    quality_drift: kpi(deltas.length, () => mean(deltas), NEEDS_SCORES),
    quality_lowered_share: kpi(deltas.length, () => share(deltas.map((d) => d < 0)), NEEDS_SCORES),
  };
}

/** What the forge tells of the delivery: CI, dates, estimates (level 2). */
function delivery(
  frames: readonly Frame[],
): Pick<KpiSet, "first_pass_green_rate" | "ci_attempts_mean" | "cycle_time_median" | "scope_gap_rate"> {
  const firstPass = defined(frames, (f) => f.metrics.first_pass_green);
  const ci = defined(frames, (f) => f.metrics.ci_attempts);
  const cycle = defined(frames, (f) => f.metrics.cycle_time_hours);
  const gaps = defined(frames, (f) => f.metrics.scope_gap);
  return {
    first_pass_green_rate: kpi(firstPass.length, () => share(firstPass), NEEDS_CI),
    ci_attempts_mean: kpi(ci.length, () => mean(ci), NEEDS_CI),
    cycle_time_median: kpi(
      cycle.length,
      () => median(cycle) as number,
      "needs issue dates from GitHub (level 2)",
    ),
    scope_gap_rate: kpi(
      gaps.length,
      () => share(gaps),
      "needs estimates and 5 earlier issues per estimate (level 2)",
    ),
  };
}

/** What the facts file tells of the agents (level 3). */
function agents(
  frames: readonly Frame[],
): Pick<
  KpiSet,
  | "success_rate"
  | "review_findings_mean"
  | "rework_rounds_mean"
  | "autonomy_rate"
  | "minutes_per_merged_issue"
  | "cost_per_merged_issue"
> {
  const m = (f: Frame) => f.metrics;
  const attempted = frames.filter((f) => (m(f).attempts ?? 0) > 0);
  const findings = frames.filter(
    (f) => m(f).review_blockers !== undefined || m(f).review_majors !== undefined,
  );
  const rounds = defined(frames, (f) => m(f).rework_rounds);
  const humans = defined(frames, (f) => m(f).human_interventions);
  const minutes = defined(frames, (f) => m(f).agent_minutes);
  const costs = defined(frames, (f) => m(f).cost);
  const sum = (list: readonly Frame[], pick: (f: Frame) => number) => list.reduce((s, f) => s + pick(f), 0);
  return {
    success_rate: kpi(
      attempted.length,
      () =>
        sum(attempted, (f) => m(f).succeeded_attempts ?? 0) / sum(attempted, (f) => m(f).attempts as number),
      "the facts have no attempt (level 3)",
    ),
    review_findings_mean: kpi(
      findings.length,
      () => mean(findings.map((f) => (m(f).review_blockers ?? 0) + (m(f).review_majors ?? 0))),
      "the facts have no review findings (level 3)",
    ),
    rework_rounds_mean: kpi(rounds.length, () => mean(rounds), "the facts have no rework rounds (level 3)"),
    autonomy_rate: kpi(
      humans.length,
      () => share(humans.map((h) => h === 0)),
      "the facts have no human interventions (level 3)",
    ),
    minutes_per_merged_issue: kpi(minutes.length, () => mean(minutes), "the facts have no minutes (level 3)"),
    cost_per_merged_issue: kpi(costs.length, () => mean(costs), "the facts have no cost (level 3)"),
  };
}

/** The KPIs of a set of issue frames over a number of days. */
export function computeKpis(frames: readonly Frame[], days: number): KpiSet {
  const n = frames.length;
  return {
    throughput: kpi(n, () => n / (Math.max(days, 1) / 7), NO_ISSUE),
    fix_share: kpi(n, () => frames.filter((f) => f.kind === "fix").length / n, NO_ISSUE),
    ...afterwards(frames),
    ...quality(frames),
    ...delivery(frames),
    ...agents(frames),
  };
}
