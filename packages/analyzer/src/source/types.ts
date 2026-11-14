export type EntryKind = "file" | "symlink" | "submodule";

export interface SourceEntry {
  /** Posix path relative to the analyzed folder. */
  path: string;
  size: number;
  kind: EntryKind;
  /** Git blob id when the entry comes from the object database. */
  blobId?: string;
}

export type SkipReason = "gitignored";

export interface ListOptions {
  /** Called for each folder before descending; return a reason to skip it (disk sources only). */
  skipDir?: (path: string, name: string) => string | undefined;
  onSkippedDir?: (reason: string) => void;
}

/** Read-only view of the files to analyze: a folder on disk or a git revision. */
export interface Source {
  readonly kind: "disk" | "git";
  /** Absolute path of the analyzed folder. */
  readonly root: string;
  /** Short commit hash when the source is a git revision. */
  readonly commit?: string;
  list(options?: ListOptions): Promise<SourceEntry[]>;
  read(entry: SourceEntry): Promise<Buffer>;
  close(): Promise<void>;
}
