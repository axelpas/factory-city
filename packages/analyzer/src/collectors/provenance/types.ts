export const DAY = 86400;

/** What happened to one file at one step: lines added, and fresh lines thrown away. */
export interface FileEvent {
  step: number;
  added: number;
  /** Lines deleted or rewritten at this step while younger than the rework horizon. */
  young: number;
}

export interface FileState {
  /** For each current line, the index of the step that wrote it. */
  origins: number[];
  events: FileEvent[];
}

/** Per-step tallies that later steps keep updating: the retrospective side of provenance. */
export interface StepTally {
  added: number;
  /** Lines this step added that were deleted or rewritten within the rework horizon. */
  reworked: number;
  /** Indices of later fix steps that touched lines this step introduced. */
  fixes: number[];
  /** Lines this step added that died within 30 and within 90 days. */
  dead30: number;
  dead90: number;
}

export interface ProvenanceOptions {
  recentDays: number;
  reworkDays: number;
}

export interface FileProvenance {
  rework_lines: number;
  rework_ratio: number;
  issues_recent: number;
  main_agent: number;
  main_agent_share: number;
}

export interface SerializedState {
  hashes: string[];
  tallies: StepTally[];
  files: Array<[string, { runs: number[]; events: FileEvent[] }]>;
}

/** A hunk is `[oldStart, oldCount, newCount]`. */
export type Hunk = readonly [number, number, number];
