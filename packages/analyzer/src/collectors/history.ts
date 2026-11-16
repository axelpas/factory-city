import { execFile } from "node:child_process";

const DAY = 86400;
const MAX_COUPLING_FILES = 50;
const MIN_CO_COMMITS = 3;
const MIN_CO_SHARE = 0.6;
const CONVENTIONAL_FIX = /^(fix|hotfix)(\([^)]*\))?!?:/i;
const FIX_BRANCH_MERGE = /(from \S*\b|Merge branch ')(hot)?fix\//i;

export interface HistoryOptions {
  recentDays: number;
  fixPatterns: string[];
}

export interface FileHistory {
  commits: number;
  recentCommits: number;
  linesAddedRecent: number;
  linesDeletedRecent: number;
  firstTime: number;
  lastTime: number;
  authors: Set<string>;
  fixCommits: number;
  fixCommitsRecent: number;
  coChangeFiles: number;
}

export interface HistoryResult {
  files: Map<string, FileHistory>;
  /** Commits read (non-merge, reachable from the revision). */
  commitCount: number;
  /** Unix time of the analyzed revision: the "now" of every window. */
  snapshotTime: number;
  /** Pairs of files that usually change together. */
  coupled: Array<[string, string]>;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, maxBuffer: 1024 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
      else ok(stdout);
    });
  });
}

export interface RawCommit {
  hash: string;
  time: number;
  author: string;
  subject: string;
  /** Changed paths at the repository root; renames carry the old path. */
  changes: Array<{ path: string; oldPath?: string; added: number; deleted: number }>;
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
    const changes: RawCommit["changes"] = [];
    for (let i = 0; i < tokens.length; i++) {
      const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i] as string);
      if (!m) continue;
      const added = m[1] === "-" ? 0 : Number(m[1]);
      const deleted = m[2] === "-" ? 0 : Number(m[2]);
      if (m[3] === "") {
        // rename: the next two tokens are the old and the new path
        const oldPath = tokens[i + 1] as string;
        const path = tokens[i + 2] as string;
        i += 2;
        if (path) changes.push({ path, oldPath, added, deleted });
      } else {
        changes.push({ path: m[3] as string, added, deleted });
      }
    }
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

/**
 * Per-file history up to `rev` and no further: the windows end at the revision's own date, so a past
 * snapshot never sees later commits. Reads the object database through `git log`; nothing is written.
 */
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

export async function collectHistory(
  topLevel: string,
  prefix: string,
  rev: string,
  files: ReadonlySet<string>,
  options: HistoryOptions,
  scope = "",
): Promise<HistoryResult> {
  const log = await loadHistoryLog(topLevel, rev, scope);
  return computeHistory(log, await revisionTime(topLevel, rev), undefined, prefix, files, options);
}

/**
 * History of the given files from a log. `reachable` restricts the log to the commits of one revision,
 * so that a frame of a timeline never uses a later commit.
 */
export function computeHistory(
  log: HistoryLog,
  snapshotTime: number,
  reachable: ReadonlySet<string> | undefined,
  prefix: string,
  files: ReadonlySet<string>,
  options: HistoryOptions,
): HistoryResult {
  const commits = reachable ? log.commits.filter((c) => reachable.has(c.hash)) : log.commits;
  const fixBranch = log.fixBranch;
  const fixPatterns = options.fixPatterns.map((p) => new RegExp(p, "i"));
  const windowStart = snapshotTime - options.recentDays * DAY;
  const cut = prefix ? prefix.length + 1 : 0;
  const inScope = (p: string) => !prefix || p.startsWith(`${prefix}/`);

  // newest to oldest: a rename tells that older commits of the old path belong to the new one
  const alias = new Map<string, string>();
  const history = new Map<string, FileHistory>();
  const pairs = new Map<string, number>();
  const resolve = (path: string) => alias.get(path) ?? path;

  for (const commit of commits) {
    const isFix =
      CONVENTIONAL_FIX.test(commit.subject) ||
      fixPatterns.some((re) => re.test(commit.subject)) ||
      fixBranch.has(commit.hash);
    const recent = commit.time >= windowStart && commit.time <= snapshotTime;
    const touched = new Set<string>();
    for (const change of commit.changes) {
      const target = resolve(change.path);
      if (change.oldPath) alias.set(change.oldPath, target);
      if (!inScope(target)) continue;
      const rel = target.slice(cut);
      if (!files.has(rel)) continue;
      let h = history.get(rel);
      if (!h) {
        h = {
          commits: 0,
          recentCommits: 0,
          linesAddedRecent: 0,
          linesDeletedRecent: 0,
          firstTime: commit.time,
          lastTime: commit.time,
          authors: new Set(),
          fixCommits: 0,
          fixCommitsRecent: 0,
          coChangeFiles: 0,
        };
        history.set(rel, h);
      }
      if (touched.has(rel)) continue;
      touched.add(rel);
      h.commits++;
      h.authors.add(commit.author);
      h.firstTime = Math.min(h.firstTime, commit.time);
      h.lastTime = Math.max(h.lastTime, commit.time);
      if (isFix) h.fixCommits++;
      if (recent) {
        h.recentCommits++;
        h.linesAddedRecent += change.added;
        h.linesDeletedRecent += change.deleted;
        if (isFix) h.fixCommitsRecent++;
      }
    }
    if (touched.size > 1 && touched.size <= MAX_COUPLING_FILES) {
      const list = [...touched].sort();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const key = `${list[i]}\0${list[j]}`;
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const coupled: Array<[string, string]> = [];
  for (const [key, together] of pairs) {
    if (together < MIN_CO_COMMITS) continue;
    const [a, b] = key.split("\0") as [string, string];
    const ha = history.get(a);
    const hb = history.get(b);
    if (ha && hb && together / ha.commits >= MIN_CO_SHARE && together / hb.commits >= MIN_CO_SHARE) {
      ha.coChangeFiles++;
      hb.coChangeFiles++;
      coupled.push([a, b]);
    }
  }
  return { files: history, commitCount: commits.length, snapshotTime, coupled };
}

/** Metrics of one file's history, in registry ids. Days are whole days before the snapshot. */
export function historyMetrics(h: FileHistory, snapshotTime: number): Record<string, number> {
  return {
    number_of_commits: h.commits,
    recent_commits: h.recentCommits,
    lines_added_recent: h.linesAddedRecent,
    lines_deleted_recent: h.linesDeletedRecent,
    age_days: Math.max(0, Math.floor((snapshotTime - h.firstTime) / DAY)),
    days_since_last_change: Math.max(0, Math.floor((snapshotTime - h.lastTime) / DAY)),
    number_of_authors: h.authors.size,
    fix_commits: h.fixCommits,
    fix_commits_recent: h.fixCommitsRecent,
    fix_ratio: h.commits === 0 ? 0 : h.fixCommits / h.commits,
    co_change_files: h.coChangeFiles,
  };
}
