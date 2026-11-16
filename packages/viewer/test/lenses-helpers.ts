import type { Factory, Frame } from "@factory-city/schema";

import { createFormat } from "../src/lib/format";

export const fmt = createFormat(["en-US"]);

export function frame(
  index: number,
  kind: Frame["kind"],
  metrics: Partial<Frame["metrics"]> = {},
  patch: Partial<Frame> = {},
): Frame {
  return {
    id: `f${index}`,
    index,
    kind,
    label: `#${index + 1} Title ${index + 1}`,
    date: "2026-01-01T00:00:00.000Z",
    commit: "c",
    subject: "s",
    commits: [],
    snapshot: "",
    totals: { files: 10 + index, rloc: 100 * (index + 1), mcc: 20 },
    added: [],
    modified: [],
    deleted: [],
    metrics: { files_touched: 3, lines_added: 100, lines_deleted: 20, folders_touched: 1, ...metrics },
    lines: {},
    issue: { number: index + 1, title: `Title ${index + 1}` },
    ...patch,
  };
}

export const factory: Factory = {
  kind: "factory",
  schemaVersion: 1,
  analyzerVersion: "t",
  createdAt: "2026-01-01T00:00:00.000Z",
  project: "demo",
  dataLevel: 2,
  definitions: {
    throughput: {
      label: "Throughput",
      definition: "Issues merged per week.",
      level: 1,
      unit: "issues per week",
    },
    fix_share: { label: "Fix share", definition: "Share of fixes.", level: 1, unit: "ratio" },
    change_fail_rate: {
      label: "Change fail rate",
      definition: "d",
      level: 1,
      unit: "ratio",
      experimental: true,
    },
    cycle_time_median: { label: "Cycle time", definition: "d", level: 2, unit: "hours" },
    cost_per_merged_issue: { label: "Cost per issue", definition: "d", level: 3, unit: "cost" },
  },
  periods: [
    {
      id: "last30",
      label: "Last 30 days",
      from: "",
      to: "",
      issues: 12,
      overall: {
        throughput: { value: 2.8, n: 12 },
        fix_share: { value: 0.25, n: 12 },
        change_fail_rate: { n: 3, reason: "needs at least 5 issues, has 3" },
        cycle_time_median: { value: 7.25, n: 12 },
      },
      previous: { throughput: { value: 2, n: 9 }, fix_share: { n: 0, reason: "no issue in this period" } },
      groups: {
        agent: {
          a: { issues: 10, comparable: true, kpis: { throughput: { value: 2, n: 10 } } },
          b: { issues: 2, comparable: false, kpis: { throughput: { n: 2, reason: "x" } } },
        },
        kind: { fix: { issues: 3, comparable: false, kpis: {} } },
      },
    },
    { id: "all", label: "Whole timeline", from: "", to: "", issues: 40, overall: {}, groups: {} },
  ],
  lists: {
    worst_quality_delta: [{ frame: 4, issue: 5, label: "#5 Title", value: 3.5 }],
    most_ci_attempts: [],
  },
  notice: "Questions, not targets.",
};
