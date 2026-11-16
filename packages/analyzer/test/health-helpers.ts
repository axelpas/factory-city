import type { Report } from "@factory-city/schema";

import { resolveDimensions } from "../src/health/dimensions.js";

import { computeHealth, findHotspots, type HealthFile } from "../src/health/health.js";

export const dims = resolveDimensions();

export const dim = (id: string) => dims.find((d) => d.id === id) as (typeof dims)[number];

export const file = (path: string, values: Record<string, number>, isTest = false): HealthFile => ({
  path,
  values,
  isTest,
});

export const FILES: HealthFile[] = [
  file("ok.ts", {
    rloc: 400,
    mcc: 30,
    max_function_complexity: 8,
    max_nesting_level: 2,
    imports_out: 3,
    escape_hatch_density: 0,
    recent_commits: 1,
    fix_commits_recent: 0,
  }),
  file("complex.ts", {
    rloc: 300,
    mcc: 120,
    max_function_complexity: 25,
    max_nesting_level: 3,
    imports_out: 4,
    escape_hatch_density: 0,
    recent_commits: 8,
    fix_commits_recent: 2,
  }),
  file("big.ts", {
    rloc: 200,
    mcc: 60,
    max_function_complexity: 12,
    max_nesting_level: 7,
    imports_out: 2,
    escape_hatch_density: 0,
    recent_commits: 0,
    fix_commits_recent: 0,
  }),
  file("consts.ts", {
    rloc: 100,
    mcc: 1,
    max_nesting_level: 0,
    imports_out: 0,
    escape_hatch_density: 0,
    recent_commits: 0,
    fix_commits_recent: 0,
  }),
];

export function report(): Report {
  return {
    kind: "report",
    schemaVersion: 1,
    analyzerVersion: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    project: "demo",
    commit: "abc1234",
    dataLevel: 1,
    health: computeHealth(FILES, dims),
    dimensions: dims,
    hotspots: findHotspots(FILES, dims),
    hiddenLinks: [],
    notice: "The score is a heuristic.",
  };
}

export const fn = (name: string, depth: number) =>
  `export function ${name}(x: number) {\n${"  if (x) {\n".repeat(depth)}  return x;\n${"  }\n".repeat(depth)}}\n`;
