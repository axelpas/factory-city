import type {
  Factory,
  FactoryGroup,
  FactoryIssueLine,
  FactoryPeriod,
  Frame,
  Kpi,
  KpiDefinition,
  KpiSet,
} from "@factory-city/schema";
import { median } from "../collectors/delivery.js";

const DAY = 86_400_000;
/** A KPI stays unavailable under this many issues. */
export const MIN_ISSUES = 5;
/** Groups are compared only from this many issues each. */
export const MIN_GROUP = 10;

export const FACTORY_NOTICE =
  "These KPIs are questions to ask about the process, not targets, and never a ranking of people. Each one shows its sample size and stays unavailable under 5 issues.";

export const KPI_DEFINITIONS: Record<string, KpiDefinition> = {
  throughput: {
    label: "Throughput",
    definition: "Issues merged per week.",
    level: 1,
    unit: "issues per week",
  },
  fix_share: {
    label: "Fix share",
    definition: "Share of merged issues that are fixes.",
    level: 1,
    unit: "ratio",
  },
  rework_rate: {
    label: "Rework rate",
    definition: "Share of added lines deleted or rewritten within 14 days.",
    level: 1,
    unit: "ratio",
  },
  shelf_life_30: {
    label: "Shelf life, 30 days",
    definition: "Share of added lines still alive after 30 days.",
    level: 1,
    unit: "ratio",
  },
  shelf_life_90: {
    label: "Shelf life, 90 days",
    definition: "Share of added lines still alive after 90 days.",
    level: 1,
    unit: "ratio",
  },
  change_fail_rate: {
    label: "Change fail rate",
    definition: "Share of issues with at least one later fix on the lines they introduced.",
    level: 1,
    unit: "ratio",
    experimental: true,
  },
  scatter: {
    label: "Scatter",
    definition: "Median number of folders touched per issue.",
    level: 1,
    unit: "folders",
  },
  quality_drift: {
    label: "Quality drift",
    definition: "Mean change of the score per issue.",
    level: 1,
    unit: "points",
  },
  quality_lowered_share: {
    label: "Issues lowering the score",
    definition: "Share of issues that lowered the score.",
    level: 1,
    unit: "ratio",
  },
  first_pass_green_rate: {
    label: "First pass green",
    definition: "Share of pull requests whose first CI attempt was green.",
    level: 2,
    unit: "ratio",
  },
  ci_attempts_mean: {
    label: "CI attempts",
    definition: "Mean number of CI attempts up to the first green one.",
    level: 2,
    unit: "attempts",
  },
  cycle_time_median: {
    label: "Cycle time",
    definition: "Median hours from opening to closing.",
    level: 2,
    unit: "hours",
  },
  scope_gap_rate: {
    label: "Scope gap rate",
    definition: "Share of issues that went well beyond their estimate.",
    level: 2,
    unit: "ratio",
  },
  success_rate: {
    label: "Success rate",
    definition: "Share of attempts that succeeded.",
    level: 3,
    unit: "ratio",
  },
  review_findings_mean: {
    label: "Review findings",
    definition: "Mean number of blocking and major review findings per issue.",
    level: 3,
    unit: "findings",
  },
  rework_rounds_mean: {
    label: "Rework rounds",
    definition: "Mean number of round trips after review or red CI, per issue.",
    level: 3,
    unit: "rounds",
  },
  autonomy_rate: {
    label: "Autonomy rate",
    definition: "Share of issues merged with no human intervention.",
    level: 3,
    unit: "ratio",
  },
  minutes_per_merged_issue: {
    label: "Minutes per issue",
    definition: "Mean agent minutes per merged issue.",
    level: 3,
    unit: "minutes",
  },
  cost_per_merged_issue: {
    label: "Cost per issue",
    definition: "Mean cost per merged issue.",
    level: 3,
    unit: "cost",
  },
};

const round = (x: number) => Math.round(x * 1000) / 1000;

/** A KPI over the issues that have the needed value; unavailable under 5 of them. */
function kpi(count: number, compute: () => number, missing: string): Kpi {
  if (count === 0) return { n: 0, reason: missing };
  if (count < MIN_ISSUES) return { n: count, reason: `needs at least ${MIN_ISSUES} issues, has ${count}` };
  return { value: round(compute()), n: count };
}

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function defined<T>(frames: readonly Frame[], pick: (f: Frame) => T | undefined): T[] {
  return frames.map(pick).filter((v): v is T => v !== undefined);
}

/** The KPIs of a set of issue frames over a number of days. */
export function computeKpis(frames: readonly Frame[], days: number): KpiSet {
  const m = (f: Frame) => f.metrics;
  const n = frames.length;
  const weighted = (share: (f: Frame) => number | undefined) => {
    const rated = frames.filter((f) => share(f) !== undefined && (m(f).lines_written ?? 0) > 0);
    const lines = rated.reduce((s, f) => s + (m(f).lines_written as number), 0);
    return {
      count: rated.length,
      value: () =>
        rated.reduce((s, f) => s + (share(f) as number) * (m(f).lines_written as number), 0) / lines,
    };
  };
  const rework = weighted((f) => m(f).rework_after);
  const alive30 = weighted((f) => m(f).alive_30);
  const alive90 = weighted((f) => m(f).alive_90);
  const caused = defined(frames, (f) => m(f).caused_fixes);
  const deltas = defined(frames, (f) => m(f).quality_delta);
  const firstPass = defined(frames, (f) => m(f).first_pass_green);
  const ci = defined(frames, (f) => m(f).ci_attempts);
  const cycle = defined(frames, (f) => m(f).cycle_time_hours);
  const gaps = defined(frames, (f) => m(f).scope_gap);
  const attempted = frames.filter((f) => (m(f).attempts ?? 0) > 0);
  const findings = frames.filter(
    (f) => m(f).review_blockers !== undefined || m(f).review_majors !== undefined,
  );
  const rounds = defined(frames, (f) => m(f).rework_rounds);
  const humans = defined(frames, (f) => m(f).human_interventions);
  const minutes = defined(frames, (f) => m(f).agent_minutes);
  const costs = defined(frames, (f) => m(f).cost);
  const pending = "needs more later history";
  return {
    throughput: kpi(n, () => n / (Math.max(days, 1) / 7), "no issue in this period"),
    fix_share: kpi(n, () => frames.filter((f) => f.kind === "fix").length / n, "no issue in this period"),
    rework_rate: kpi(rework.count, rework.value, `${pending}: 14 days after each issue`),
    shelf_life_30: kpi(alive30.count, alive30.value, `${pending}: 30 days after each issue`),
    shelf_life_90: kpi(alive90.count, alive90.value, `${pending}: 90 days after each issue`),
    change_fail_rate: kpi(
      caused.length,
      () => caused.filter((c) => c > 0).length / caused.length,
      "needs line provenance",
    ),
    scatter: kpi(
      n,
      () => median(frames.map((f) => m(f).folders_touched)) as number,
      "no issue in this period",
    ),
    quality_drift: kpi(deltas.length, () => mean(deltas), "needs a score before and after each issue"),
    quality_lowered_share: kpi(
      deltas.length,
      () => deltas.filter((d) => d < 0).length / deltas.length,
      "needs a score before and after each issue",
    ),
    first_pass_green_rate: kpi(
      firstPass.length,
      () => firstPass.filter(Boolean).length / firstPass.length,
      "needs CI runs on pull requests (level 2)",
    ),
    ci_attempts_mean: kpi(ci.length, () => mean(ci), "needs CI runs on pull requests (level 2)"),
    cycle_time_median: kpi(
      cycle.length,
      () => median(cycle) as number,
      "needs issue dates from GitHub (level 2)",
    ),
    scope_gap_rate: kpi(
      gaps.length,
      () => gaps.filter(Boolean).length / gaps.length,
      "needs estimates and 5 earlier issues per estimate (level 2)",
    ),
    success_rate: kpi(
      attempted.length,
      () =>
        attempted.reduce((s, f) => s + (m(f).succeeded_attempts ?? 0), 0) /
        attempted.reduce((s, f) => s + (m(f).attempts as number), 0),
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
      () => humans.filter((h) => h === 0).length / humans.length,
      "the facts have no human interventions (level 3)",
    ),
    minutes_per_merged_issue: kpi(minutes.length, () => mean(minutes), "the facts have no minutes (level 3)"),
    cost_per_merged_issue: kpi(costs.length, () => mean(costs), "the facts have no cost (level 3)"),
  };
}

function groupsOf(frames: readonly Frame[], days: number): FactoryPeriod["groups"] {
  const keys: Array<[string, (f: Frame) => string | undefined]> = [
    ["agent", (f) => f.metrics.agent],
    ["model", (f) => f.metrics.model],
    ["kind", (f) => f.kind],
    ["estimate", (f) => f.metrics.estimate],
  ];
  const tags = new Set<string>();
  for (const f of frames) for (const t of Object.keys(f.metrics.tags ?? {})) tags.add(t);
  for (const tag of [...tags].sort()) keys.push([`tag:${tag}`, (f) => f.metrics.tags?.[tag]]);
  const out: FactoryPeriod["groups"] = {};
  for (const [name, pick] of keys) {
    const buckets = new Map<string, Frame[]>();
    for (const f of frames) {
      const value = pick(f);
      if (value === undefined) continue;
      const list = buckets.get(value);
      if (list) list.push(f);
      else buckets.set(value, [f]);
    }
    if (buckets.size === 0) continue;
    const group: Record<string, FactoryGroup> = {};
    for (const [value, list] of [...buckets].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      group[value] = {
        issues: list.length,
        comparable: list.length >= MIN_GROUP,
        kpis: computeKpis(list, days),
      };
    }
    out[name] = group;
  }
  return out;
}

function line(f: Frame, value: number): FactoryIssueLine {
  return {
    frame: f.index,
    ...(f.issue ? { issue: f.issue.number } : {}),
    label: f.label,
    ...(f.issue?.url ? { url: f.issue.url } : {}),
    value: round(value),
  };
}

function worst(
  frames: readonly Frame[],
  pick: (f: Frame) => number | undefined,
  top = 5,
): FactoryIssueLine[] {
  return frames
    .map((f) => [f, pick(f)] as const)
    .filter((x): x is readonly [Frame, number] => x[1] !== undefined && x[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].index - b[0].index)
    .slice(0, top)
    .map(([f, v]) => line(f, v));
}

export interface FactoryInput {
  project: string;
  analyzerVersion: string;
  dataLevel: 0 | 1 | 2 | 3;
  /** All frames of a per-issue timeline; frames of unlinked commits are left out. */
  frames: readonly Frame[];
  now?: Date;
}

/** The factory KPIs of a per-issue timeline: the last 30 days against the 30 before, and the whole timeline. */
export function computeFactory(input: FactoryInput): Factory {
  const issues = input.frames.filter((f) => f.issue !== undefined);
  const times = issues.map((f) => Date.parse(f.date));
  const end = times.length ? Math.max(...times) : (input.now ?? new Date()).getTime();
  const start = times.length ? Math.min(...times) : end;
  const within = (from: number, to: number) =>
    issues.filter((f) => Date.parse(f.date) > from && Date.parse(f.date) <= to);
  const iso = (t: number) => new Date(t).toISOString();
  const last = within(end - 30 * DAY, end);
  const allDays = Math.max((end - start) / DAY, 1);
  const periods: FactoryPeriod[] = [
    {
      id: "last30",
      label: "Last 30 days",
      from: iso(end - 30 * DAY),
      to: iso(end),
      issues: last.length,
      overall: computeKpis(last, 30),
      previous: computeKpis(within(end - 60 * DAY, end - 30 * DAY), 30),
      groups: groupsOf(last, 30),
    },
    {
      id: "all",
      label: "Whole timeline",
      from: iso(start),
      to: iso(end),
      issues: issues.length,
      overall: computeKpis(issues, allDays),
      groups: groupsOf(issues, allDays),
    },
  ];
  return {
    kind: "factory",
    schemaVersion: 1,
    analyzerVersion: input.analyzerVersion,
    createdAt: (input.now ?? new Date()).toISOString(),
    project: input.project,
    dataLevel: input.dataLevel,
    definitions: KPI_DEFINITIONS,
    periods,
    lists: {
      worst_quality_delta: worst(issues, (f) =>
        f.metrics.quality_delta === undefined ? undefined : -f.metrics.quality_delta,
      ),
      widest_scope_gap: worst(issues, (f) =>
        f.metrics.scope_gap ? f.metrics.lines_added + f.metrics.lines_deleted : undefined,
      ),
      most_ci_attempts: worst(issues, (f) =>
        (f.metrics.ci_attempts ?? 0) > 1 ? f.metrics.ci_attempts : undefined,
      ),
      highest_rework_after: worst(issues, (f) => f.metrics.rework_after),
      most_caused_fixes: worst(issues, (f) => f.metrics.caused_fixes),
    },
    notice: FACTORY_NOTICE,
  };
}
