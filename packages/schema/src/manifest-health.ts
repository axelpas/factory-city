export type RiskLevel = "low" | "moderate" | "high" | "veryHigh";

/** One dimension of the risk profile: the metric it reads and the upper bounds of low, moderate and high. */
export interface RiskDimension {
  id: string;
  label: string;
  metric: string;
  /** Static dimensions enter the score; history dimensions do not. */
  kind: "static" | "history";
  /** Upper bounds (inclusive) of low, moderate and high; above the last one is very high. */
  bounds: [number, number, number];
  /** Files under this many real lines are not rated on this dimension. */
  minRloc?: number;
  /** Where the bounds come from, or "project default, not a standard". */
  source: string;
}

/** Share of code (by real lines) at each risk level, for one dimension. */
export interface RiskShare {
  low: number;
  moderate: number;
  high: number;
  veryHigh: number;
  /** Share of all code that could be rated on this dimension. */
  rated: number;
}

export interface Health {
  /** Share of code, out of 100, in files that are low risk on every static dimension available for them. */
  score: number;
  /** The same share, with the security dimension left out of the rating of every file. */
  scoreWithoutSecurity: number;
  /** Dimension id to shares. A dimension with no rated code is absent. */
  profile: Record<string, RiskShare>;
  /** Static dimensions that entered the score. */
  scored: string[];
}

export type ActionType =
  | "split-file"
  | "extract-functions"
  | "flatten-nesting"
  | "deduplicate"
  | "reduce-imports"
  | "remove-shortcuts"
  | "add-tests"
  | "separate-concerns"
  | "review-security";

export interface HotspotAction {
  type: ActionType;
  /** One sentence saying what to do, with the names it needs (cohesion groups, shortcut kinds). */
  text: string;
}

export interface Hotspot {
  path: string;
  rank: number;
  /** Why it ranks: complexity with recent change, or with size when there is no history. */
  basis: "complexity-and-change" | "complexity-and-size";
  metrics: Record<string, number>;
  /** Dimensions rated high or very high, with their level. */
  exceeded: Array<{ dimension: string; level: RiskLevel; value: number; bound: number }>;
  actions: HotspotAction[];
  /** Rough size of the work. */
  size: "S" | "M" | "L";
}

export interface HiddenLink {
  kind: "co-change-without-import" | "imports-mostly-elsewhere";
  files: string[];
  detail: string;
}

/** `report.json`: the code-health report of one snapshot. Deterministic and rule-based. */
export interface Report {
  kind: "report";
  schemaVersion: 1;
  analyzerVersion: string;
  createdAt: string;
  project: string;
  commit?: string;
  dataLevel: 0 | 1 | 2 | 3;
  health: Health;
  dimensions: RiskDimension[];
  hotspots: Hotspot[];
  /** Experimental. */
  hiddenLinks: HiddenLink[];
  notice: string;
}

/** Health of one frame, kept in the timeline manifest. */
export interface FrameHealth {
  score: number;
  /** The score without the security dimension; absent in data written before it existed. */
  scoreWithoutSecurity?: number;
  profile: Record<string, RiskShare>;
  /** Paths of the frame's hotspots, best rank first. */
  hotspots: string[];
}
