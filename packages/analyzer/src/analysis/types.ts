import type { AnalysisManifest, CcJson, DependencyAudit, Report } from "@factory-city/schema";
import type { HistoryResult } from "../collectors/history.js";
import type { FileProvenance } from "../collectors/provenance.js";
import type { Config } from "../config.js";
import type { HealthFile } from "../health/health.js";
import type { ContentProblem } from "../inspect.js";
import type { FileMetrics } from "../metrics/file-metrics.js";
import type { BlobReader } from "../source/blob-reader.js";
import type { RepoInfo } from "../source/git.js";

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
  /** Optional collector (`--with audit`): known vulnerabilities of the lockfile, asked to OSV. Needs the network. */
  audit?: boolean;
  /** The network is forbidden (`--offline`): the audit refuses to run. */
  offline?: boolean;
  /** Where the audit says what it sends; silent without it. */
  log?: (line: string) => void;
  /** Replaces `fetch` for the audit, so that tests replay recorded answers. */
  auditFetch?: typeof fetch;
  /** SARIF files written by third-party scanners (`--sarif`): their results become metrics, labeled as such. */
  sarif?: string[];
  /** State shared by the frames of a timeline: caches and a preloaded history. */
  shared?: AnalyzeShared;
}

/** What is known about one file content, cached by blob id so that each unique content is parsed once. */
export type CachedFile = { problem: ContentProblem } | { result: FileMetrics };

export interface AnalyzeShared {
  fileCache: Map<string, CachedFile>;
  /** The repository, looked up once for all frames. */
  repo?: RepoInfo;
  /** Short hash of each revision (by full hash), asked once for all frames. */
  shortHashes?: ReadonlyMap<string, string>;
  /** One `git cat-file --batch` process for all frames; the timeline closes it. */
  blobReader?: BlobReader;
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
  /** Known vulnerabilities of the dependencies, when `--with audit` was given and could be done. */
  dependencies?: DependencyAudit;
  /** Code-health report of the snapshot. */
  report: Report;
  /** Per-file values, for callers that compute more from them (frame health). */
  files: HealthFile[];
}

/** The numbers of each file, by metric id. */
export type FileValues = Map<string, Record<string, number>>;
