import { git } from "../../git.js";

const FIX_BRANCH_MERGE = /(from \S*\b|Merge branch ')(hot)?fix\//i;

export interface RawCommit {
  hash: string;
  time: number;
  author: string;
  subject: string;
  /** Changed paths at the repository root; renames carry the old path. */
  changes: Array<{ path: string; oldPath?: string; added: number; deleted: number }>;
}

/** The changed paths of one commit, from its numstat tokens; a rename takes the next two tokens (old, new). */
function parseChanges(tokens: string[]): RawCommit["changes"] {
  const changes: RawCommit["changes"] = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i] as string);
    if (!m) continue;
    const added = m[1] === "-" ? 0 : Number(m[1]);
    const deleted = m[2] === "-" ? 0 : Number(m[2]);
    if (m[3] !== "") {
      changes.push({ path: m[3] as string, added, deleted });
      continue;
    }
    const oldPath = tokens[i + 1] as string;
    const path = tokens[i + 2] as string;
    i += 2;
    if (path) changes.push({ path, oldPath, added, deleted });
  }
  return changes;
}

/** Parses `git log --numstat -z -M` output written with our record separators. */
export function parseLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const chunk of output.split("\u0001")) {
    if (!chunk) continue;
    const end = chunk.indexOf("\u0003");
    if (end < 0) continue;
    const [hash = "", time = "0", author = "", subject = ""] = chunk.slice(0, end).split("\u0002");
    // after the header git writes NUL, a line break, then NUL-separated numstat records
    const tokens = chunk
      .slice(end + 1)
      .split("\0")
      .map((t) => t.replace(/^\n+/, ""));
    const changes = parseChanges(tokens);
    commits.push({ hash, time: Number(time), author: author.toLowerCase(), subject, changes });
  }
  return commits;
}

/** Commits that arrived through a branch named fix/ (found from the merge commits). */
async function fixBranchCommits(topLevel: string, rev: string): Promise<Set<string>> {
  const out = new Set<string>();
  const merges = (await git(topLevel, ["log", rev, "--merges", "--format=%H%x02%P%x02%s"]))
    .split("\n")
    .filter(Boolean);
  for (const line of merges.slice(0, 300)) {
    const [, parents = "", subject = ""] = line.split("\u0002");
    const [first, second] = parents.split(" ");
    if (!first || !second || !FIX_BRANCH_MERGE.test(subject)) continue;
    for (const hash of (await git(topLevel, ["rev-list", `${first}..${second}`])).split("\n"))
      if (hash) out.add(hash);
  }
  return out;
}

/** The commits reachable from a revision, read once and reusable for every earlier revision. */
export interface HistoryLog {
  commits: RawCommit[];
  fixBranch: Set<string>;
}

/**
 * The commits reachable from a revision with the files each one changed. A `scope` (a folder of the
 * repository) narrows the log to the changes under it: on a partial clone, git then fetches only the blobs of
 * that folder instead of every blob the history ever changed.
 */
export async function loadHistoryLog(topLevel: string, rev: string, scope = ""): Promise<HistoryLog> {
  const raw = await git(topLevel, [
    "log",
    rev,
    "--no-merges",
    "--topo-order",
    "-M",
    "--numstat",
    "-z",
    "--format=%x01%H%x02%ct%x02%ae%x02%s%x03",
    ...(scope ? ["--", scope] : []),
  ]);
  return { commits: parseLog(raw), fixBranch: await fixBranchCommits(topLevel, rev) };
}

/** Hashes of the non-merge commits reachable from a revision. */
export async function reachableCommits(topLevel: string, rev: string): Promise<Set<string>> {
  return new Set((await git(topLevel, ["rev-list", "--no-merges", rev])).split("\n").filter(Boolean));
}

export async function revisionTime(topLevel: string, rev: string): Promise<number> {
  return Number((await git(topLevel, ["show", "-s", "--format=%ct", `${rev}^{commit}`])).trim());
}

/**
 * The non-merge commits reachable from each of several revisions, from one `git rev-list --parents` instead of
 * one `git rev-list` per revision. The answer for a revision is the same as `reachableCommits` gives.
 */
export async function reachability(
  topLevel: string,
  revs: readonly string[],
): Promise<(rev: string) => Set<string>> {
  const parents = new Map<string, string[]>();
  if (revs.length > 0) {
    const raw = await git(topLevel, ["rev-list", "--parents", ...revs]);
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const [hash, ...rest] = line.split(" ");
      parents.set(hash as string, rest);
    }
  }
  return (rev) => {
    const seen = new Set<string>();
    const out = new Set<string>();
    const stack = [rev];
    while (stack.length > 0) {
      const hash = stack.pop() as string;
      if (seen.has(hash)) continue;
      seen.add(hash);
      const up = parents.get(hash);
      if (up === undefined) continue;
      if (up.length <= 1) out.add(hash);
      for (const p of up) stack.push(p);
    }
    return out;
  };
}

/**
 * Short hash of each revision, asked in a few calls instead of one per revision (`rev-parse --short` takes a
 * single revision). `%h` is abbreviated the way `rev-parse --short` does it.
 */
export async function shortHashes(topLevel: string, revs: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; from < revs.length; from += 100) {
    const chunk = revs.slice(from, from + 100);
    const raw = await git(topLevel, [
      "-c",
      "log.showSignature=false",
      "log",
      "--no-walk=unsorted",
      "--format=%H %h",
      ...chunk,
    ]);
    for (const line of raw.split("\n")) {
      const [full, short] = line.split(" ");
      if (full && short) out.set(full, short);
    }
  }
  return out;
}
