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
export type TimelineMode = "commit" | "day" | "issue" | "revs";

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
  };
  /** Lines added and deleted per file by this frame's commits: `[added, deleted]`. */
  lines: Record<string, [number, number]>;
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
