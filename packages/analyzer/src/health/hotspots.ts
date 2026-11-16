import type { Hotspot, RiskDimension } from "@factory-city/schema";
import { actionsFor } from "./actions.js";
import { rate } from "./dimensions.js";
import type { HealthExtras, HealthFile } from "./types.js";

function percentile(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

const KEY_METRICS = [
  "rloc",
  "mcc",
  "max_function_complexity",
  "max_nesting_level",
  "imports_out",
  "cohesion_groups",
  "escape_hatches",
  "recent_commits",
  "fix_commits_recent",
  "rework_ratio",
  "issues_recent",
];

/** The dimensions on which a file is high or very high, with its value and the bound it passes. */
function exceededOf(f: HealthFile, dimensions: readonly RiskDimension[]): Hotspot["exceeded"] {
  const exceeded: Hotspot["exceeded"] = [];
  for (const d of dimensions) {
    const level = rate(f.values, d);
    if (level !== "high" && level !== "veryHigh") continue;
    exceeded.push({
      dimension: d.id,
      level,
      value: f.values[d.metric] as number,
      bound: level === "veryHigh" ? d.bounds[2] : d.bounds[1],
    });
  }
  return exceeded;
}

/**
 * The top hotspots: complex code that changes often, or complex and large code when there is no history.
 * Tests are left out. Ties are broken by path, so the ranking is deterministic.
 */
export function findHotspots(
  files: readonly HealthFile[],
  dimensions: readonly RiskDimension[],
  extras: HealthExtras = {},
  top = 5,
): Hotspot[] {
  const code = files.filter((f) => !f.isTest && f.values.mcc !== undefined);
  const withChange = code.some((f) => (f.values.recent_commits ?? 0) > 0);
  const second = withChange ? "recent_commits" : "rloc";
  const sorted = (metric: string) => code.map((f) => f.values[metric] ?? 0).sort((a, b) => a - b);
  const complexity = sorted("mcc");
  const other = sorted(second);
  const ranked = code
    .map((f) => ({
      f,
      heat: percentile(complexity, f.values.mcc ?? 0) * percentile(other, f.values[second] ?? 0),
    }))
    .filter((x) => !withChange || (x.f.values.recent_commits ?? 0) > 0)
    .sort((a, b) => b.heat - a.heat || (a.f.path < b.f.path ? -1 : 1))
    .slice(0, top);
  return ranked.map(({ f }, i) => {
    const exceeded = exceededOf(f, dimensions);
    const metrics: Record<string, number> = {};
    for (const id of KEY_METRICS) if (f.values[id] !== undefined) metrics[id] = f.values[id] as number;
    const rloc = f.values.rloc ?? 0;
    return {
      path: f.path,
      rank: i + 1,
      basis: withChange ? "complexity-and-change" : "complexity-and-size",
      metrics,
      exceeded,
      actions: actionsFor(f, exceeded, extras),
      size: rloc < 150 ? "S" : rloc < 500 ? "M" : "L",
    };
  });
}
