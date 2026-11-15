/** Summary of what an analysis left out, by reason. */
export interface IgnoreSummary {
  /** Files left out, by reason. */
  files: Record<string, number>;
  /** Folders skipped before reading them, by reason. */
  folders: Record<string, number>;
  /** Entries skipped with a warning (binary, submodule, ...). */
  warnings: Record<string, number>;
}

/** `analysis.json`: what the analyzer knows about a snapshot besides the cc.json itself. */
export interface AnalysisManifest {
  kind: "snapshot";
  schemaVersion: 1;
  analyzerVersion: string;
  createdAt: string;
  project: string;
  source: { kind: "disk" | "git"; rev?: string; commit?: string; path?: string };
  /** Highest data level whose metrics are in this snapshot. */
  dataLevel: 0 | 1 | 2 | 3;
  git: { available: boolean; shallow: boolean };
  metrics: string[];
  /** Labels of category metrics: the snapshot stores the index. */
  categories: Record<string, string[]>;
  selected: number;
  analyzed: number;
  ignored: IgnoreSummary;
  warnings: string[];
  snapshot: string;
}

export type FrameKind = "feature" | "fix" | "refactor" | "chore" | "docs" | "test" | "unknown";
export type TimelineMode = "commit" | "day" | "issue" | "revs" | "diff";

/** How a commit was linked to an issue, in priority order; `unlinked` when no strategy applied. */
export type LinkStrategy = "closing-keyword" | "pull-request" | "reference" | "branch" | "unlinked";

/** The issue a frame stands for. Title, state, labels and url are known at data level 2 only. */
export interface FrameIssue {
  number: number;
  title?: string;
  state?: string;
  labels?: string[];
  url?: string;
  /** Pull request that carried the work, when known. */
  pullRequest?: number;
}

/** How many commits each strategy linked, and how many stayed unlinked. */
export interface CoverageReport {
  commits: number;
  linked: number;
  byStrategy: Record<LinkStrategy, number>;
  issues: number;
  /** True when issue titles and pull requests came from the forge. */
  forge: boolean;
}

/** One step of a timeline: a commit, a day or an issue. It points to one snapshot. */
export interface Frame {
  id: string;
  index: number;
  kind: FrameKind;
  /** Short text for the timeline bar: short hash and subject, or a date. */
  label: string;
  /** ISO date (UTC) of the frame's commit. */
  date: string;
  /** Short hash of the commit the snapshot was taken at. */
  commit: string;
  subject: string;
  /** Short hashes of the commits this frame adds to the previous one. */
  commits: string[];
  /** Snapshot file, relative to the manifest. */
  snapshot: string;
  totals: { files: number; rloc: number; mcc: number };
  /** Files added, modified and deleted since the previous frame. */
  added: string[];
  modified: string[];
  deleted: string[];
  metrics: {
    files_touched: number;
    lines_added: number;
    lines_deleted: number;
    folders_touched: number;
    /** Retrospective. Absent while pending (under 14 days of later history) or without provenance. */
    rework_after?: number;
    /** True while `rework_after` waits for 14 days of later history. */
    rework_after_pending?: boolean;
    /** Retrospective, experimental. Absent without provenance. */
    caused_fixes?: number;
    /** Lines the frame's steps added on the first-parent history: the base of the retrospective shares. */
    lines_written?: number;
    /** Retrospective. Share of those lines still alive after 30 and after 90 days; absent until that long has passed. */
    alive_30?: number;
    alive_90?: number;
    /** Score after minus score before. Absent for the first frame. */
    quality_delta?: number;
    hotspots_created?: number;
    hotspots_resolved?: number;
    /** Silenced checks added by the frame (negative when it removed some). */
    shortcuts_added?: number;
    /** Level 2. Size label of the issue (S, M, L, XL); may also come from facts. */
    estimate?: string;
    /** Level 2. True when files or lines touched exceed twice the median of earlier issues with the same estimate. Absent under 5 earlier issues. */
    scope_gap?: boolean;
    /** Level 2. CI attempts on the pull request up to the first green one. Absent without CI. */
    ci_attempts?: number;
    first_pass_green?: boolean;
    /** Level 2. Hours from the issue's opening to its closing, else from the pull request's opening to its merge. */
    cycle_time_hours?: number;
    /** Level 3, from the facts file. */
    agent?: string;
    model?: string;
    outcome?: FactOutcome;
    attempts?: number;
    succeeded_attempts?: number;
    review_blockers?: number;
    review_majors?: number;
    rework_rounds?: number;
    agent_minutes?: number;
    cost?: number;
    currency?: string;
    human_interventions?: number;
    /** Columns of the facts file that map to no known field, kept to group KPIs. */
    tags?: Record<string, string>;
  };
  /** Lines added and deleted per file by this frame's commits: `[added, deleted]`. */
  lines: Record<string, [number, number]>;
  /** Score, risk profile and hotspots of the frame. */
  health?: FrameHealth;
  /** Issue mode: the issue this frame stands for; absent for a frame of unlinked commits. */
  issue?: FrameIssue;
  /** Issue mode: true for a frame that groups the commits of one day linked to no issue. */
  unlinked?: boolean;
}

/** `timeline.json`: the ordered frames of a repository's history and what they share. */
export interface TimelineManifest {
  kind: "timeline";
  schemaVersion: 1;
  analyzerVersion: string;
  createdAt: string;
  project: string;
  source: { mode: TimelineMode; branch: string; firstParent: boolean; sampledFrom?: number };
  dataLevel: 0 | 1 | 2 | 3;
  git: { available: boolean; shallow: boolean };
  metrics: string[];
  categories: Record<string, string[]>;
  ignored: IgnoreSummary;
  warnings: string[];
  /** Issue mode: how commits were linked to issues. */
  coverage?: CoverageReport;
  frames: Frame[];
}

/** One file's change between the base and the head of a diff. */
export interface DiffFileChange {
  path: string;
  status: "added" | "removed" | "modified";
  /** Change of real lines and of complexity (head minus base; the whole value for added or removed files). */
  rloc: number;
  mcc: number;
}

/** `factory-city diff --json`: what a branch does to the city. */
export interface DiffSummary {
  kind: "diff";
  schemaVersion: 1;
  project: string;
  base: { rev: string; commit: string };
  head: { rev: string; commit: string };
  files: { added: number; removed: number; modified: number; unchanged: number };
  totals: {
    base: { files: number; rloc: number; mcc: number };
    head: { files: number; rloc: number; mcc: number };
    delta: { files: number; rloc: number; mcc: number };
  };
  /** Silenced checks the branch adds (head minus base), in total and by kind; negative when it removes some. */
  shortcuts: { added: number; byKind: Record<string, number> };
  /** The largest changes, by lines and complexity moved. */
  biggest: DiffFileChange[];
  /** Score out of 100 at the base and at the head. */
  quality: { base: number; head: number; delta: number };
  /** Hotspots the branch creates and resolves. */
  hotspots: { created: string[]; resolved: string[] };
}

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
  | "separate-concerns";

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
  profile: Record<string, RiskShare>;
  /** Paths of the frame's hotspots, best rank first. */
  hotspots: string[];
}

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
