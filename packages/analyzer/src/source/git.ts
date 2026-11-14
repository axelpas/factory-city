import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ListOptions, Source, SourceEntry } from "./types.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
      else ok(stdout);
    });
  });
}

/** Full hash of a revision. */
export async function revParse(topLevel: string, rev: string): Promise<string> {
  return (await git(topLevel, ["rev-parse", `${rev}^{commit}`])).trim();
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

/** Reads blobs through one `git cat-file --batch` process, one request at a time. */
class BlobReader {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private waiting: (() => void) | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private failed: Error | undefined;

  constructor(cwd: string) {
    this.proc = spawn("git", ["cat-file", "--batch"], { cwd });
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.waiting?.();
    });
    this.proc.on("error", (err) => {
      this.failed = err;
      this.waiting?.();
    });
    this.proc.stdin.on("error", () => {});
  }

  read(id: string): Promise<Buffer> {
    const run = this.queue.then(() => this.readOne(id));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readOne(id: string): Promise<Buffer> {
    this.proc.stdin.write(`${id}\n`);
    for (;;) {
      if (this.failed) throw this.failed;
      const nl = this.buffer.indexOf(10);
      if (nl >= 0) {
        const header = this.buffer.subarray(0, nl).toString("utf8");
        const parts = header.split(" ");
        if (parts[1] === "missing") throw new Error(`git object ${id} is missing`);
        const size = Number(parts[2]);
        const end = nl + 1 + size + 1;
        if (this.buffer.length >= end) {
          const content = Buffer.from(this.buffer.subarray(nl + 1, nl + 1 + size));
          this.buffer = this.buffer.subarray(end);
          return content;
        }
      }
      await new Promise<void>((ok) => {
        this.waiting = ok;
      });
    }
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

/** Files of one git revision, read from the object database (no checkout, no write). */
export class GitSource implements Source {
  readonly kind = "git" as const;
  private reader: BlobReader | undefined;

  private constructor(
    readonly root: string,
    private readonly repo: RepoInfo,
    readonly rev: string,
    readonly commit: string,
  ) {}

  static async open(folder: string, repo: RepoInfo, rev = "HEAD"): Promise<GitSource> {
    const root = resolve(folder);
    const commit = (await git(repo.topLevel, ["rev-parse", "--short", `${rev}^{commit}`])).trim();
    return new GitSource(root, repo, rev, commit);
  }

  async list(_options: ListOptions = {}): Promise<SourceEntry[]> {
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
    this.reader ??= new BlobReader(this.repo.topLevel);
    return this.reader.read(entry.blobId);
  }

  async close(): Promise<void> {
    this.reader?.close();
    this.reader = undefined;
  }
}
