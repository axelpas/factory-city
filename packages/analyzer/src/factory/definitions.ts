import type { KpiDefinition } from "@factory-city/schema";

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
