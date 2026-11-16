import type { Factory, FactoryGroup, FactoryIssueLine, FactoryPeriod, Frame } from "@factory-city/schema";
import { computeKpis, round } from "./compute.js";
import { FACTORY_NOTICE, KPI_DEFINITIONS, MIN_GROUP } from "./definitions.js";

export { computeKpis } from "./compute.js";
export { FACTORY_NOTICE, KPI_DEFINITIONS, MIN_GROUP, MIN_ISSUES } from "./definitions.js";

const DAY = 86_400_000;

type Pick = (f: Frame) => string | undefined;

/** What the issues can be grouped by: the fixed attributes, then each tag the facts file names. */
function groupKeys(frames: readonly Frame[]): Array<[string, Pick]> {
  const keys: Array<[string, Pick]> = [
    ["agent", (f) => f.metrics.agent],
    ["model", (f) => f.metrics.model],
    ["kind", (f) => f.kind],
    ["estimate", (f) => f.metrics.estimate],
  ];
  const tags = new Set(frames.flatMap((f) => Object.keys(f.metrics.tags ?? {})));
  for (const tag of [...tags].sort()) keys.push([`tag:${tag}`, (f) => f.metrics.tags?.[tag]]);
  return keys;
}

/** The issues of each value of an attribute; the issues that do not have one are left out. */
function bucketsOf(frames: readonly Frame[], pick: Pick): Map<string, Frame[]> {
  const buckets = new Map<string, Frame[]>();
  for (const f of frames) {
    const value = pick(f);
    if (value === undefined) continue;
    buckets.set(value, [...(buckets.get(value) ?? []), f]);
  }
  return buckets;
}

function groupsOf(frames: readonly Frame[], days: number): FactoryPeriod["groups"] {
  const out: FactoryPeriod["groups"] = {};
  for (const [name, pick] of groupKeys(frames)) {
    const buckets = bucketsOf(frames, pick);
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
