/** Data levels (specification 6.2): 0 files, 1 git history, 2 forge, 3 facts. */
export type DataLevel = 0 | 1 | 2 | 3;
export type MetricDirection = "higher-is-worse" | "higher-is-better" | "neutral";
export type MetricKind = "number" | "ratio" | "category";
export type MetricScope = "file" | "folder" | "frame" | "factory";

export interface MetricDefinition {
  id: string;
  label: string;
  /** One sentence. */
  definition: string;
  computation: string;
  why: string;
  unit: string;
  direction: MetricDirection;
  kind: MetricKind;
  scope: MetricScope;
  level: DataLevel;
  limits: string;
  experimental: boolean;
  retrospective: boolean;
  /** Plain-language reading of a high value, for legends: "more complex". */
  higherMeans?: string;
}

export function metric(
  m: Omit<MetricDefinition, "experimental" | "retrospective" | "scope" | "kind"> &
    Partial<Pick<MetricDefinition, "experimental" | "retrospective" | "scope" | "kind">>,
): MetricDefinition {
  return { experimental: false, retrospective: false, scope: "file", kind: "number", ...m };
}
