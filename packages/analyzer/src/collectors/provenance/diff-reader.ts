import type { Hunk } from "./types.js";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A path as git prints it: a quoted string when it holds odd characters. */
function unquote(path: string): string {
  const p = path.replace(/\t$/, "");
  if (!p.startsWith('"')) return p;
  try {
    return JSON.parse(p) as string;
  } catch {
    return p.slice(1, -1);
  }
}

/** What the diff of a file changed, once it is complete. */
export interface FileDiff {
  oldPath?: string;
  newPath?: string;
  renameFrom?: string;
  deleted: boolean;
  hunks: Hunk[];
}

/** What the reader reports as it goes through the output of `git log -p -U0`. */
export interface DiffEvents {
  /** A commit begins. */
  commit(hash: string): void;
  /** The diff of one file is complete. */
  file(diff: FileDiff): void;
}

function emptyDiff(): FileDiff {
  return { deleted: false, hunks: [] };
}

/** The text of a path line (`--- a/x`, `+++ b/x`), without the side prefix; nothing for /dev/null. */
function sidePath(line: string, side: "a" | "b"): string | undefined {
  const p = line.slice(4);
  return p === "/dev/null" ? undefined : unquote(p).replace(new RegExp(`^${side}/`), "");
}

/** Reads the lines of `git log -p -U0` one by one, a small state machine over file headers and hunks. */
export class DiffReader {
  private current = emptyDiff();
  /** Body lines of the current hunk still to come: their content must never be read as a header. */
  private body = 0;

  constructor(private readonly events: DiffEvents) {}

  /** Reports the diff of the file being read, and starts a new one. */
  flush(): void {
    this.events.file(this.current);
    this.current = emptyDiff();
  }

  feed(line: string): void {
    if (this.body > 0 && (line.startsWith("+") || line.startsWith("-"))) {
      this.body--;
      return;
    }
    if (line.startsWith("\\")) return; // "\ No newline at end of file"
    if (line.startsWith("\u0001")) this.events.commit(line.slice(1).trim());
    else if (line.startsWith("diff --git ")) {
      this.flush();
      this.body = 0;
    } else this.header(line);
  }

  private header(line: string): void {
    const d = this.current;
    if (line.startsWith("rename from ")) d.renameFrom = unquote(line.slice(12));
    else if (line.startsWith("rename to ")) d.newPath = unquote(line.slice(10));
    else if (line.startsWith("deleted file mode")) d.deleted = true;
    else if (line.startsWith("--- ")) d.oldPath = sidePath(line, "a") ?? d.oldPath;
    else if (line.startsWith("+++ ")) d.newPath = sidePath(line, "b") ?? d.newPath;
    else if (line.startsWith("@@")) this.hunk(line);
  }

  private hunk(line: string): void {
    const m = HUNK.exec(line);
    if (!m) return;
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    this.current.hunks.push([Number(m[1]), oldCount, newCount]);
    this.body = oldCount + newCount;
  }
}
