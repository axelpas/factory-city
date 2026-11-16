import type { RiskDimension, RiskLevel } from "@factory-city/schema";
import { DIMENSIONS } from "./dimension-table.js";

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

export { DIMENSIONS } from "./dimension-table.js";
