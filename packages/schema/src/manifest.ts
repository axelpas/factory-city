import type { FactOutcome } from "./manifest-factory.js";
import type { FrameHealth } from "./manifest-health.js";

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

export * from "./manifest-diff.js";
export * from "./manifest-factory.js";
export * from "./manifest-health.js";
