export type FactOutcome = "succeeded" | "failed" | "abandoned" | "blocked";

/** One issue (or commit) of `facts.json`: what neither the code nor the forge knows. */
export interface Fact {
  /** Issue number, or absent when the fact is keyed by a commit. */
  issue?: number;
  commit?: string;
  /** Date of the last row, as written in the file. */
  date?: string;
  agent?: string;
  model?: string;
  outcome?: FactOutcome;
  estimate?: string;
  /** Number of attempt rows, and how many of them succeeded. */
  attempts: number;
  succeeded_attempts: number;
  review_blockers?: number;
  review_majors?: number;
  rework_rounds?: number;
  minutes?: number;
  cost?: number;
  currency?: string;
  human_interventions?: number;
  tags: Record<string, string>;
}

/** `facts.json`: the normalized import of a facts file. Private by default. */
export interface Facts {
  kind: "facts";
  schemaVersion: 1;
  createdAt: string;
  /** Rows read, rows kept by the filter, and rows that could not be keyed. */
  rows: { read: number; kept: number; skipped: number };
  /** Known fields that the mapping provides: a KPI whose field is absent is unavailable, not zero. */
  fields: string[];
  facts: Fact[];
}

/** One KPI value. `value` is absent when the KPI is unavailable; `n` is its sample size. */
export interface Kpi {
  value?: number;
  n: number;
  /** Why the KPI is unavailable. */
  reason?: string;
}

export type KpiSet = Record<string, Kpi>;

export interface FactoryGroup {
  issues: number;
  /** False under 10 issues: too few to compare with other groups. */
  comparable: boolean;
  kpis: KpiSet;
}

export interface FactoryPeriod {
  id: "last30" | "all";
  label: string;
  from: string;
  to: string;
  issues: number;
  overall: KpiSet;
  /** The period just before, for comparison; absent for the whole timeline. */
  previous?: KpiSet;
  /** KPIs by group (`agent`, `model`, `kind`, `estimate`), then by the group's value. */
  groups: Record<string, Record<string, FactoryGroup>>;
}

export interface FactoryIssueLine {
  frame: number;
  issue?: number;
  label: string;
  url?: string;
  value: number;
}

export interface KpiDefinition {
  label: string;
  definition: string;
  level: 1 | 2 | 3;
  unit: string;
  experimental?: boolean;
}

/** `factory.json`: the factory KPIs of a per-issue timeline. Questions to ask about the process, not targets. */
export interface Factory {
  kind: "factory";
  schemaVersion: 1;
  analyzerVersion: string;
  createdAt: string;
  project: string;
  dataLevel: 0 | 1 | 2 | 3;
  definitions: Record<string, KpiDefinition>;
  periods: FactoryPeriod[];
  /** Issue lists, each sorted worst first. */
  lists: Record<string, FactoryIssueLine[]>;
  notice: string;
}
