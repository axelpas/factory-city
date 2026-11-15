import type { RiskDimension, RiskLevel } from "@factory-city/schema";

const DEFAULT = "project default, not a standard";

/**
 * The dimensions of the risk profile. Bounds are the upper limits of low, moderate and high. Each one says
 * where it comes from; `thresholds` in `factory-city.config.json` overrides any of them.
 */
export const DIMENSIONS: readonly RiskDimension[] = [
  {
    id: "size",
    label: "File size",
    metric: "rloc",
    kind: "static",
    bounds: [200, 400, 750],
    source: DEFAULT,
  },
  {
    id: "complexity",
    label: "Complexity",
    metric: "max_function_complexity",
    kind: "static",
    bounds: [10, 20, 50],
    source:
      "McCabe's cyclomatic complexity bands for one function: 1-10, 11-20, 21-50, above 50 (McCabe 1976, as used by the SEI)",
  },
  {
    id: "nesting",
    label: "Nesting",
    metric: "max_nesting_level",
    kind: "static",
    bounds: [3, 4, 6],
    source: `${DEFAULT} (lint rules commonly cap depth at 4)`,
  },
  {
    id: "coupling",
    label: "Coupling",
    metric: "imports_out",
    kind: "static",
    bounds: [10, 20, 30],
    source: DEFAULT,
  },
  {
    id: "cohesion",
    label: "Cohesion",
    metric: "cohesion_groups",
    kind: "static",
    bounds: [1, 2, 4],
    minRloc: 100,
    source:
      "LCOM4: one group is cohesive, two or more suggest a split (Hitz and Montazeri); the bands above two are a project default",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    metric: "escape_hatch_density",
    kind: "static",
    bounds: [2, 8, 20],
    source: DEFAULT,
  },
  {
    id: "duplication",
    label: "Duplication",
    metric: "duplication_ratio",
    kind: "static",
    bounds: [0.03, 0.05, 0.2],
    source: DEFAULT,
  },
  {
    id: "change",
    label: "Change",
    metric: "recent_commits",
    kind: "history",
    bounds: [2, 5, 10],
    source: DEFAULT,
  },
  {
    id: "fixes",
    label: "Fixes",
    metric: "fix_commits_recent",
    kind: "history",
    bounds: [0, 1, 3],
    source: DEFAULT,
  },
  {
    id: "rework",
    label: "Rework",
    metric: "rework_ratio",
    kind: "history",
    bounds: [0.1, 0.25, 0.5],
    source: DEFAULT,
  },
];

/** Applies the configuration's threshold overrides to the default dimensions. */
export function resolveDimensions(overrides: Record<string, [number, number, number]> = {}): RiskDimension[] {
  return DIMENSIONS.map((d) => {
    const bounds = overrides[d.id];
    return bounds ? { ...d, bounds, source: "set in factory-city.config.json" } : { ...d };
  });
}

/** The risk level of a value on a dimension. */
export function levelOf(value: number, dimension: RiskDimension): RiskLevel {
  const [low, moderate, high] = dimension.bounds;
  if (value <= low) return "low";
  if (value <= moderate) return "moderate";
  if (value <= high) return "high";
  return "veryHigh";
}

/** The level of a file on a dimension, or undefined when the dimension does not apply to it. */
export function rate(values: Record<string, number>, dimension: RiskDimension): RiskLevel | undefined {
  const value = values[dimension.metric];
  if (value === undefined) return undefined;
  if (dimension.minRloc !== undefined && (values.rloc ?? 0) < dimension.minRloc) return undefined;
  return levelOf(value, dimension);
}
