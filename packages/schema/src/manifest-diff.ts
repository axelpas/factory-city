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
