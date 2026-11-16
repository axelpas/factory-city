import type { FrameIssue, FrameKind, TimelineManifest, TimelineMode } from "@factory-city/schema";
import type { GhRunner } from "../collectors/forge.js";

export interface TimelineOptions {
  folder: string;
  by: "commit" | "day" | "issue";
  /** Overrides the mode written in the manifest and the file names (used by `diff`). */
  mode?: TimelineMode;
  /** No network: issue titles are not loaded; issues are still found from git data. */
  offline?: boolean;
  /** How `gh` is run; tests replay recorded output. */
  gh?: GhRunner;
  /** Facts file (agent, model, outcome, cost per issue); the mapping comes from the configuration. */
  facts?: string;
  branch?: string;
  /** Every commit instead of the first-parent history. */
  allCommits?: boolean;
  since?: string;
  until?: string;
  /** `A..B`. */
  range?: string;
  /** Explicit revisions, in order. */
  revs?: string[];
  maxFrames?: number;
  path?: string;
  all?: boolean;
  include?: string[];
  exclude?: string[];
  onProgress?: (done: number, total: number) => void;
}

export interface TimelineResult {
  manifest: TimelineManifest;
  dataDir: string;
  /** Unique file contents parsed during this run, and those answered by the cache. */
  cache: { parsed: number; reused: number };
  /** First-parent steps replayed for line provenance in this run, and steps restored from the cache. */
  provenance: { replayed: number; reused: number };
}

/** A revision picked as a frame, with what the frame stands for in issue mode. */
export interface Rev {
  hash: string;
  time: number;
  subject: string;
  /** Issue mode: what the frame stands for. */
  meta?: { label: string; kind: FrameKind; issue?: FrameIssue; unlinked?: boolean };
}
