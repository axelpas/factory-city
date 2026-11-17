import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AnalyzeShared } from "../analysis/types.js";
import { git } from "../git.js";
import { BlobReader } from "./blob-reader.js";
import type { ListOptions, Source, SourceEntry } from "./types.js";

/** Full hash of a revision. */
export async function revParse(topLevel: string, rev: string): Promise<string> {
  return (await git(topLevel, ["rev-parse", `${rev}^{commit}`])).trim();
}

/**
 * The folder of the repository that an analysis looks at: the folder it was started in and `--path` joined,
 * as a path from the root of the repository ("" when it looks at all of it).
 */
export function scopeOf(prefix: string, path?: string): string {
  const sub = (path ?? "").replace(/^\.\//, "").replace(/\/+$/, "");
  return [prefix, sub].filter(Boolean).join("/");
}

/** Result of looking for a git repository around a folder. */
export interface RepoInfo {
  topLevel: string;
  /** Folder relative to the repository root, posix, "" for the root. */
  prefix: string;
  hasCommits: boolean;
  shallow: boolean;
}

export async function findRepo(folder: string): Promise<RepoInfo | undefined> {
  try {
    const topLevel = await realpath((await git(folder, ["rev-parse", "--show-toplevel"])).trim());
    const prefix = relative(topLevel, await realpath(resolve(folder)))
      .split(sep)
      .join("/");
    let hasCommits = true;
    try {
      await git(folder, ["rev-parse", "--verify", "-q", "HEAD"]);
    } catch {
      hasCommits = false;
    }
    const shallow =
      (await git(folder, ["rev-parse", "--is-shallow-repository"]).catch(() => "false")).trim() === "true";
    return { topLevel, prefix, hasCommits, shallow };
  } catch {
    return undefined;
  }
}

/** Files of one git revision, read from the object database (no checkout, no write). */
export class GitSource implements Source {
  readonly kind = "git" as const;
  private reader: BlobReader | undefined;
  private listed: Promise<SourceEntry[]> | undefined;

  private constructor(
    readonly root: string,
    private readonly repo: RepoInfo,
    readonly rev: string,
    readonly commit: string,
    /** A reader shared with other revisions: it is not ours to close. */
    private readonly shared?: BlobReader,
  ) {}

  /** `shared` holds what a timeline looked up once for all its revisions: short hashes and the blob reader. */
  static async open(
    folder: string,
    repo: RepoInfo,
    rev = "HEAD",
    shared?: Pick<AnalyzeShared, "shortHashes" | "blobReader">,
  ): Promise<GitSource> {
    const root = resolve(folder);
    const commit =
      shared?.shortHashes?.get(rev) ??
      (await git(repo.topLevel, ["rev-parse", "--short", `${rev}^{commit}`])).trim();
    return new GitSource(root, repo, rev, commit, shared?.blobReader);
  }

  /** The files of the revision. The listing ignores the options (a revision has no folder to skip), so it is made once. */
  list(_options: ListOptions = {}): Promise<SourceEntry[]> {
    this.listed ??= this.readList();
    return this.listed;
  }

  private async readList(): Promise<SourceEntry[]> {
    const args = ["ls-tree", "-r", "-z", "--long", this.rev];
    if (this.repo.prefix) args.push("--", `${this.repo.prefix}/`);
    const raw = await git(this.repo.topLevel, args);
    const out: SourceEntry[] = [];
    const cut = this.repo.prefix ? this.repo.prefix.length + 1 : 0;
    for (const record of raw.split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      const [mode, type, blobId, size] = record.slice(0, tab).split(/\s+/);
      const path = record.slice(tab + 1).slice(cut);
      if (type === "commit") out.push({ path, size: 0, kind: "submodule" });
      else if (mode === "120000") out.push({ path, size: 0, kind: "symlink", blobId });
      else out.push({ path, size: Number(size) || 0, kind: "file", blobId });
    }
    return out;
  }

  read(entry: SourceEntry): Promise<Buffer> {
    if (!entry.blobId) throw new Error(`No blob id for ${entry.path}`);
    this.reader ??= this.shared ?? new BlobReader(this.repo.topLevel);
    return this.reader.read(entry.blobId);
  }

  async close(): Promise<void> {
    if (this.reader !== this.shared) this.reader?.close();
    this.reader = undefined;
  }
}
