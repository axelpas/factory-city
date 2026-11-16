import type { HistoryLog } from "./log.js";

const DAY = 86400;
const MAX_COUPLING_FILES = 50;
const MIN_CO_COMMITS = 3;
const MIN_CO_SHARE = 0.6;
const CONVENTIONAL_FIX = /^(fix|hotfix)(\([^)]*\))?!?:/i;

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

type Commit = HistoryLog["commits"][number];

function emptyHistory(time: number): FileHistory {
  return {
    commits: 0,
    recentCommits: 0,
    linesAddedRecent: 0,
    linesDeletedRecent: 0,
    firstTime: time,
    lastTime: time,
    authors: new Set(),
    fixCommits: 0,
    fixCommitsRecent: 0,
    coChangeFiles: 0,
  };
}

/** What one commit changed in one file, added to the history of the file. */
function addChange(
  h: FileHistory,
  commit: Commit,
  change: Commit["changes"][number],
  isFix: boolean,
  recent: boolean,
) {
  h.commits++;
  h.authors.add(commit.author);
  h.firstTime = Math.min(h.firstTime, commit.time);
  h.lastTime = Math.max(h.lastTime, commit.time);
  if (isFix) h.fixCommits++;
  if (!recent) return;
  h.recentCommits++;
  h.linesAddedRecent += change.added;
  h.linesDeletedRecent += change.deleted;
  if (isFix) h.fixCommitsRecent++;
}

/** Counts a pair of files for every two files a commit touched together (small commits only). */
function countPairs(pairs: Map<string, number>, touched: ReadonlySet<string>): void {
  if (touched.size <= 1 || touched.size > MAX_COUPLING_FILES) return;
  const list = [...touched].sort();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const key = `${list[i]}\0${list[j]}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
}

/** The pairs that changed together often, and in most of the commits of each; each file counts its partners. */
function coupledFiles(pairs: ReadonlyMap<string, number>, history: ReadonlyMap<string, FileHistory>) {
  const coupled: Array<[string, string]> = [];
  for (const [key, together] of pairs) {
    if (together < MIN_CO_COMMITS) continue;
    const [a, b] = key.split("\0") as [string, string];
    const ha = history.get(a);
    const hb = history.get(b);
    if (!ha || !hb || together / ha.commits < MIN_CO_SHARE || together / hb.commits < MIN_CO_SHARE) continue;
    ha.coChangeFiles++;
    hb.coChangeFiles++;
    coupled.push([a, b]);
  }
  return coupled;
}

/** What the history reads along the way: renames, the history of each file, and the pairs changed together. */
interface Accumulator {
  alias: Map<string, string>;
  history: Map<string, FileHistory>;
  pairs: Map<string, number>;
}

/** The files of the analyzed folder, as the history sees them: which paths count, and how they are named. */
interface Scope {
  prefix: string;
  files: ReadonlySet<string>;
}

/** One commit: its changes to the files of the scope are added to their histories, and its pairs counted. */
function addCommit(acc: Accumulator, commit: Commit, scope: Scope, isFix: boolean, recent: boolean): void {
  const cut = scope.prefix ? scope.prefix.length + 1 : 0;
  const touched = new Set<string>();
  for (const change of commit.changes) {
    const target = acc.alias.get(change.path) ?? change.path;
    if (change.oldPath) acc.alias.set(change.oldPath, target);
    const rel = target.slice(cut);
    if ((scope.prefix && !target.startsWith(`${scope.prefix}/`)) || !scope.files.has(rel)) continue;
    const h = acc.history.get(rel) ?? emptyHistory(commit.time);
    acc.history.set(rel, h);
    if (touched.has(rel)) continue;
    touched.add(rel);
    addChange(h, commit, change, isFix, recent);
  }
  countPairs(acc.pairs, touched);
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
  const fixPatterns = options.fixPatterns.map((p) => new RegExp(p, "i"));
  const windowStart = snapshotTime - options.recentDays * DAY;
  // newest to oldest: a rename tells that older commits of the old path belong to the new one
  const acc: Accumulator = { alias: new Map(), history: new Map(), pairs: new Map() };
  for (const commit of commits) {
    const isFix =
      CONVENTIONAL_FIX.test(commit.subject) ||
      fixPatterns.some((re) => re.test(commit.subject)) ||
      log.fixBranch.has(commit.hash);
    const recent = commit.time >= windowStart && commit.time <= snapshotTime;
    addCommit(acc, commit, { prefix, files }, isFix, recent);
  }
  return {
    files: acc.history,
    commitCount: commits.length,
    snapshotTime,
    coupled: coupledFiles(acc.pairs, acc.history),
  };
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
