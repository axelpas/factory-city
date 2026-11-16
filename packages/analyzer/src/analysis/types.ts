import type { AnalysisManifest, CcJson, Report } from "@factory-city/schema";
import type { HistoryResult } from "../collectors/history.js";
import type { FileProvenance } from "../collectors/provenance.js";
import type { Config } from "../config.js";
import type { HealthFile } from "../health/health.js";
import type { ContentProblem } from "../inspect.js";
import type { FileMetrics } from "../metrics/file-metrics.js";

export interface AnalyzeOptions {
  folder: string;
  /** Analyze a commit, tag or branch instead of HEAD. */
  rev?: string;
  /** Analyze the files on disk, including uncommitted changes. */
  dirty?: boolean;
  /** Restrict to a subfolder. */
  path?: string;
  all?: boolean;
  include?: string[];
  exclude?: string[];
  /** Optional collector (`--with duplication`): copied blocks across the analyzed files. */
  duplication?: boolean;
  /** State shared by the frames of a timeline: caches and a preloaded history. */
  shared?: AnalyzeShared;
}

/** What is known about one file content, cached by blob id so that each unique content is parsed once. */
export type CachedFile = { problem: ContentProblem } | { result: FileMetrics };

export interface AnalyzeShared {
  fileCache: Map<string, CachedFile>;
  /** The configuration, read once for all frames. */
  config?: Config;
  /** History of the files at a revision; replaces the per-call `git log`. */
  history?: (rev: string, files: ReadonlySet<string>) => Promise<HistoryResult>;
  /** Line provenance at a revision (full hash), from the timeline's single replay. */
  provenance?: (hash: string) => { metrics?: Map<string, FileProvenance>; labels: string[] } | undefined;
}

export interface AnalysisResult {
  /** Blob id per analyzed path, when the source is a git revision. */
  blobs: Map<string, string>;
  snapshot: CcJson;
  manifest: AnalysisManifest;
  /** Code-health report of the snapshot. */
  report: Report;
  /** Per-file values, for callers that compute more from them (frame health). */
  files: HealthFile[];
}

/** The numbers of each file, by metric id. */
export type FileValues = Map<string, Record<string, number>>;
