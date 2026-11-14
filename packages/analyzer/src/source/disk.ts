import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GitIgnore, GitIgnoreStack } from "../gitignore.js";
import type { ListOptions, Source, SourceEntry } from "./types.js";

export interface DiskSourceOptions {
  /** Honor .gitignore files found while walking (default true). */
  respectGitignore?: boolean;
}

/** Files on disk, including uncommitted changes. Never writes. */
export class DiskSource implements Source {
  readonly kind = "disk" as const;
  private readonly respectGitignore: boolean;

  constructor(
    readonly root: string,
    options: DiskSourceOptions = {},
  ) {
    this.respectGitignore = options.respectGitignore ?? true;
  }

  async list(options: ListOptions = {}): Promise<SourceEntry[]> {
    const out: SourceEntry[] = [];
    const ignores = new GitIgnoreStack();
    await this.walk("", ignores, options, out);
    return out;
  }

  private async walk(
    rel: string,
    ignores: GitIgnoreStack,
    options: ListOptions,
    out: SourceEntry[],
  ): Promise<void> {
    const dir = rel ? join(this.root, rel) : this.root;
    const names = (await readdir(dir)).sort();
    if (this.respectGitignore && names.includes(".gitignore")) {
      try {
        ignores.push(new GitIgnore(await readFile(join(dir, ".gitignore"), "utf8"), rel));
      } catch {
        // unreadable .gitignore: ignore it
      }
    }
    for (const name of names) {
      if (name === ".git") continue;
      const path = rel ? `${rel}/${name}` : name;
      const info = await lstat(join(dir, name));
      if (info.isDirectory()) {
        const reason =
          options.skipDir?.(path, name) ??
          (this.respectGitignore && ignores.isIgnored(path, true) ? "gitignored" : undefined);
        if (reason) {
          options.onSkippedDir?.(reason);
          continue;
        }
        await this.walk(path, ignores, options, out);
      } else if (info.isSymbolicLink()) {
        out.push({ path, size: 0, kind: "symlink" });
      } else if (info.isFile()) {
        if (this.respectGitignore && ignores.isIgnored(path, false)) {
          options.onSkippedDir?.("gitignored-file");
          continue;
        }
        out.push({ path, size: info.size, kind: "file" });
      }
    }
  }

  read(entry: SourceEntry): Promise<Buffer> {
    return readFile(join(this.root, entry.path));
  }

  async close(): Promise<void> {}
}
