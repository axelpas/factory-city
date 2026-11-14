import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Frame, FrameKind, TimelineManifest, TimelineMode } from "@factory-city/schema";
import type { AnalyzeShared, CachedFile } from "./analyze.js";
import { ANALYZER_VERSION, analyze } from "./analyze.js";
import { computeHistory, loadHistoryLog, reachableCommits } from "./collectors/history.js";
import { loadConfig } from "./config.js";
import { findRepo } from "./source/git.js";

export interface TimelineOptions {
  folder: string;
  by: "commit" | "day";
  branch?: string;
  /** Every commit instead of the first-parent history. */
  allCommits?: boolean;
  since?: string;
  until?: string;
  /** `A..B`. */
  range?: string;
  /** Explicit revisions, in order. */
  revs?: string[];
  maxFrames?: number;
  path?: string;
  all?: boolean;
  include?: string[];
  exclude?: string[];
  onProgress?: (done: number, total: number) => void;
}

export interface TimelineResult {
  manifest: TimelineManifest;
  dataDir: string;
  /** Unique file contents parsed during this run, and those answered by the cache. */
  cache: { parsed: number; reused: number };
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
      else ok(stdout);
    });
  });
}

interface Rev {
  hash: string;
  time: number;
  subject: string;
}

const KINDS: Record<string, FrameKind> = {
  feat: "feature",
  feature: "feature",
  fix: "fix",
  hotfix: "fix",
  refactor: "refactor",
  perf: "refactor",
  chore: "chore",
  build: "chore",
  ci: "chore",
  style: "chore",
  revert: "chore",
  docs: "docs",
  doc: "docs",
  test: "test",
  tests: "test",
};

/** Kind of a step, read from the conventional-commit type of its subject. */
export function kindOfSubject(subject: string): FrameKind {
  const m = /^([a-z]+)(\([^)]*\))?!?:/i.exec(subject.trim());
  return (m && KINDS[(m[1] as string).toLowerCase()]) || "unknown";
}

/** Even sampling that always keeps the first and the last item. */
export function sample<T>(items: T[], max: number | undefined): T[] {
  if (!max || max < 2 || items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))] as T);
  return out;
}

function parseRevs(raw: string): Rev[] {
  return raw
    .split("\u0001")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [hash = "", time = "0", subject = ""] = c.split("\u0002");
      return { hash, time: Number(time), subject };
    });
}

async function listRevs(topLevel: string, opts: TimelineOptions, branch: string): Promise<Rev[]> {
  const format = "--format=%x01%H%x02%ct%x02%s";
  if (opts.revs?.length) {
    const out: Rev[] = [];
    for (const rev of opts.revs)
      out.push(...parseRevs(await git(topLevel, ["show", "-s", format, `${rev}^{commit}`])));
    return out;
  }
  const args = ["log", "--reverse", format];
  if (!opts.allCommits) args.push("--first-parent");
  else args.push("--topo-order");
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  args.push(opts.range ?? branch);
  return parseRevs(await git(topLevel, args));
}

/** Keeps the last commit of each calendar day (UTC). */
export function lastOfEachDay(revs: Rev[]): Rev[] {
  const byDay = new Map<string, Rev>();
  for (const rev of revs) byDay.set(new Date(rev.time * 1000).toISOString().slice(0, 10), rev);
  return [...byDay.values()];
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
}

async function loadFileCache(path: string): Promise<Map<string, CachedFile>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      version: string;
      entries: Array<[string, CachedFile]>;
    };
    if (parsed.version === ANALYZER_VERSION) return new Map(parsed.entries);
  } catch {
    // no cache yet, or unreadable: start empty
  }
  return new Map();
}

/**
 * Builds a timeline: one snapshot per frame, each analyzed from the object database at its own revision.
 * Every unique file content is parsed once (cache by blob id and analyzer version); the git log is read once.
 */
export async function buildTimeline(opts: TimelineOptions, dataDir: string): Promise<TimelineResult> {
  const folder = resolve(opts.folder);
  const repo = await findRepo(folder);
  if (!repo)
    throw new Error(
      `A timeline needs a git repository, but ${folder} is not inside one. Use \`factory-city analyze\` for a plain folder.`,
    );
  if (!repo.hasCommits) throw new Error("This repository has no commit yet: there is no history to play.");

  const branch = opts.branch ?? "HEAD";
  let revs = await listRevs(repo.topLevel, opts, branch);
  const mode: TimelineMode = opts.revs?.length ? "revs" : opts.by;
  if (mode === "day") revs = lastOfEachDay(revs);
  if (revs.length === 0) throw new Error("No commit matches the given branch, range or dates.");
  const total = revs.length;
  revs = sample(revs, opts.maxFrames);

  const config = await loadConfig(folder);
  const tip = revs[revs.length - 1] as Rev;
  const log = await loadHistoryLog(repo.topLevel, opts.revs?.length ? "--all" : tip.hash);
  const byHash = new Map(log.commits.map((c) => [c.hash, c]));
  const cachePath = join(dataDir, "cache", "files.json");
  const fileCache = await loadFileCache(cachePath);
  const cachedBefore = fileCache.size;
  let reachable = new Set<string>();
  const shared: AnalyzeShared = {
    fileCache,
    history: async (_rev, files) =>
      computeHistory(log, currentTime, reachable, repo.prefix, files, {
        recentDays: config.windows.recentDays,
        fixPatterns: config.fixPatterns,
      }),
  };
  let currentTime = 0;

  const framesDir = join(dataDir, `frames.${mode}`);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(join(dataDir, "cache"), { recursive: true });

  const frames: Frame[] = [];
  const metrics = new Set<string>();
  const warnings = new Set<string>();
  let previousBlobs = new Map<string, string>();
  let previousReachable = new Set<string>();
  let last: Awaited<ReturnType<typeof analyze>> | undefined;
  let lookups = 0;

  for (const [index, rev] of revs.entries()) {
    reachable = await reachableCommits(repo.topLevel, rev.hash);
    currentTime = rev.time;
    const sizeBefore = fileCache.size;
    const result = await analyze({
      folder,
      rev: rev.hash,
      path: opts.path,
      all: opts.all,
      include: opts.include,
      exclude: opts.exclude,
      shared,
    });
    lookups += result.manifest.selected - (fileCache.size - sizeBefore);
    last = result;
    for (const m of result.manifest.metrics) metrics.add(m);
    for (const w of result.manifest.warnings) warnings.add(w);

    const added: string[] = [];
    const modified: string[] = [];
    for (const [path, blob] of result.blobs) {
      const before = previousBlobs.get(path);
      if (before === undefined) added.push(path);
      else if (before !== blob) modified.push(path);
    }
    const deleted = [...previousBlobs.keys()].filter((p) => !result.blobs.has(p));

    const newCommits = [...reachable].filter((h) => !previousReachable.has(h));
    let linesAdded = 0;
    let linesDeleted = 0;
    const lines: Record<string, [number, number]> = {};
    const cut = repo.prefix ? repo.prefix.length + 1 : 0;
    if (index > 0) {
      for (const hash of newCommits) {
        for (const change of byHash.get(hash)?.changes ?? []) {
          linesAdded += change.added;
          linesDeleted += change.deleted;
          if (repo.prefix && !change.path.startsWith(`${repo.prefix}/`)) continue;
          const rel = change.path.slice(cut);
          if (!result.blobs.has(rel) && !previousBlobs.has(rel)) continue;
          const entry = lines[rel] ?? [0, 0];
          lines[rel] = [entry[0] + change.added, entry[1] + change.deleted];
        }
      }
    }
    const touched = [...added, ...modified, ...deleted];
    const folders = new Set(touched.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")));
    const totals = { files: 0, rloc: 0, mcc: 0 };
    for (const values of Object.values(result.snapshot.lenses.metrics.attributes)) {
      if (values.loc === undefined) continue;
      totals.files++;
      totals.rloc += values.rloc ?? 0;
      totals.mcc += values.mcc ?? 0;
    }
    const short = rev.hash.slice(0, 8);
    const id = `${String(index + 1).padStart(4, "0")}-${short}`;
    const date = new Date(rev.time * 1000).toISOString();
    await writeAtomic(join(framesDir, `${id}.cc.json`), JSON.stringify(result.snapshot));
    frames.push({
      id,
      index,
      kind: kindOfSubject(rev.subject),
      label: mode === "day" ? date.slice(0, 10) : `${short.slice(0, 7)} ${rev.subject}`,
      date,
      commit: short,
      subject: rev.subject,
      commits: index === 0 ? [short] : newCommits.map((h) => h.slice(0, 8)),
      snapshot: `frames.${mode}/${id}.cc.json`,
      totals,
      added: index === 0 ? [] : added.sort(),
      modified: modified.sort(),
      deleted: deleted.sort(),
      metrics: {
        files_touched: index === 0 ? 0 : touched.length,
        lines_added: linesAdded,
        lines_deleted: linesDeleted,
        folders_touched: index === 0 ? 0 : folders.size,
      },
      lines,
    });
    previousBlobs = result.blobs;
    previousReachable = reachable;
    opts.onProgress?.(index + 1, revs.length);
  }

  if (!last) throw new Error("No frame was produced.");
  const manifest: TimelineManifest = {
    kind: "timeline",
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    createdAt: new Date().toISOString(),
    project: basename(folder),
    source: {
      mode,
      branch: opts.range ?? branch,
      firstParent: !opts.allCommits && !opts.revs?.length,
      ...(total !== revs.length ? { sampledFrom: total } : {}),
    },
    dataLevel: last.manifest.dataLevel,
    git: last.manifest.git,
    metrics: [...metrics].sort(),
    categories: last.manifest.categories,
    ignored: last.manifest.ignored,
    warnings: [...warnings],
    frames,
  };
  await writeAtomic(join(dataDir, `timeline.${mode}.json`), `${JSON.stringify(manifest)}\n`);
  await writeAtomic(cachePath, JSON.stringify({ version: ANALYZER_VERSION, entries: [...fileCache] }));
  return {
    manifest,
    dataDir,
    cache: { parsed: fileCache.size - cachedBefore, reused: Math.max(0, lookups) },
  };
}
