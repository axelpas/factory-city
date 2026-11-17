import type { FrameHealth, Health, RiskDimension, RiskShare } from "@factory-city/schema";
import { rate } from "./dimensions.js";
import { findHotspots } from "./hotspots.js";
import type { HealthFile } from "./types.js";

export { findHiddenLinks } from "./hidden-links.js";
export { findHotspots } from "./hotspots.js";
export type { HealthExtras, HealthFile } from "./types.js";

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/** How the real lines of code spread over the risk levels of one dimension; nothing when no file is rated. */
function riskShare(files: readonly HealthFile[], d: RiskDimension, total: number): RiskShare | undefined {
  const weight = { low: 0, moderate: 0, high: 0, veryHigh: 0 };
  let rated = 0;
  for (const f of files) {
    const level = rate(f.values, d);
    if (!level) continue;
    const w = f.values.rloc ?? 0;
    weight[level] += w;
    rated += w;
  }
  if (rated === 0) return undefined;
  return {
    low: round(weight.low / rated),
    moderate: round(weight.moderate / rated),
    high: round(weight.high / rated),
    veryHigh: round(weight.veryHigh / rated),
    rated: round(total === 0 ? 0 : rated / total),
  };
}

/** Real lines of the files that are low risk on every static dimension. */
function healthyLines(files: readonly HealthFile[], statics: readonly RiskDimension[]): number {
  let healthy = 0;
  for (const f of files) {
    const levels = statics.map((d) => rate(f.values, d)).filter((l) => l !== undefined);
    if (levels.every((l) => l === "low")) healthy += f.values.rloc ?? 0;
  }
  return healthy;
}

/** The dimensions left out of the score without security: our own signals and the findings of a scanner. */
const SECURITY = new Set(["security", "scanner"]);

/** Risk profile and score of a set of files, weighted by real lines of code. */
export function computeHealth(files: readonly HealthFile[], dimensions: readonly RiskDimension[]): Health {
  const total = files.reduce((sum, f) => sum + (f.values.rloc ?? 0), 0);
  const profile: Record<string, RiskShare> = {};
  const scored: string[] = [];
  for (const d of dimensions) {
    const share = riskShare(files, d, total);
    if (!share) continue;
    profile[d.id] = share;
    if (d.kind === "static") scored.push(d.id);
  }
  const statics = dimensions.filter((d) => d.kind === "static");
  const percent = (lines: number) => (total === 0 ? 100 : round((lines / total) * 100, 1));
  return {
    score: percent(healthyLines(files, statics)),
    scoreWithoutSecurity: percent(
      healthyLines(
        files,
        statics.filter((d) => !SECURITY.has(d.id)),
      ),
    ),
    profile,
    scored,
  };
}

/** The health of a frame, as kept in the timeline manifest. */
export function frameHealth(
  files: readonly HealthFile[],
  dimensions: readonly RiskDimension[],
  top = 5,
): FrameHealth {
  const health = computeHealth(files, dimensions);
  return {
    score: health.score,
    scoreWithoutSecurity: health.scoreWithoutSecurity,
    profile: health.profile,
    hotspots: findHotspots(files, dimensions, {}, top).map((h) => h.path),
  };
}
