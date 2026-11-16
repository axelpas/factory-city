import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  CoverageReport,
  Facts,
  Frame,
  FrameHealth,
  FrameIssue,
  FrameKind,
  TimelineManifest,
  TimelineMode,
} from "@factory-city/schema";
import { bodyChecksum, nodeId } from "@factory-city/schema";
import type { AnalyzeShared, CachedFile } from "./analyze.js";
import { ANALYZER_VERSION, analyze } from "./analyze.js";
import { addCostShares, enrichFrames } from "./collectors/enrich.js";
import { autoMapping, importFacts } from "./collectors/facts.js";
import { type GhRunner, loadForge, systemGh } from "./collectors/forge.js";
import { computeHistory, loadHistoryLog, reachableCommits } from "./collectors/history.js";
import {
  type CommitMessage,
  emptyCoverage,
  type ForgeData,
  frameIssue,
  kindOf,
  linkStep,
} from "./collectors/issues.js";
import { buildLineage, type Lineage } from "./collectors/lineage.js";
import { type Config, loadConfig } from "./config.js";
import { computeFactory } from "./factory/kpis.js";
import { resolveDimensions } from "./health/dimensions.js";
import { frameHealth } from "./health/health.js";
import { findRepo, scopeOf } from "./source/git.js";

export interface TimelineOptions {
  folder: string;
  by: "commit" | "day" | "issue";
  /** Overrides the mode written in the manifest and the file names (used by `diff`). */
  mode?: TimelineMode;
  /** No network: issue titles are not loaded; issues are still found from git data. */
  offline?: boolean;
  /** How `gh` is run; tests replay recorded output. */
  gh?: GhRunner;
  /** Facts file (agent, model, outcome, cost per issue); the mapping comes from the configuration. */
  facts?: string;
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
  /** First-parent steps replayed for line provenance in this run, and steps restored from the cache. */
  provenance: { replayed: number; reused: number };
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
  /** Issue mode: what the frame stands for. */
  meta?: { label: string; kind: FrameKind; issue?: FrameIssue; unlinked?: boolean };
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

/** The branch to name in the manifest: `HEAD` becomes the current branch, or `detached <commit>` on a detached HEAD. */
export async function branchLabel(topLevel: string, branch: string): Promise<string> {
  if (branch !== "HEAD") return branch;
  try {
    const name = (await git(topLevel, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (name && name !== "HEAD") return name;
    const commit = (await git(topLevel, ["rev-parse", "--short", "HEAD"])).trim();
    return commit ? `detached ${commit}` : "HEAD";
  } catch {
    return "HEAD";
  }
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

/** Reads and imports the facts file given on the command line, or named in the configuration. */
async function loadFacts(
  folder: string,
  given: string | undefined,
  config: Config,
): Promise<Facts | undefined> {
  const path = given ? resolve(given) : config.facts?.file ? resolve(folder, config.facts.file) : undefined;
  if (!path) return undefined;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `The facts file ${path} could not be read. Check the path given to --facts or in factory-city.config.json.`,
    );
  }
  const mapping = config.facts ?? autoMapping(text);
  if (!mapping) {
    throw new Error(
      'The facts file needs a mapping: add "facts": { "columns": { "issue": "<column>", ... } } to factory-city.config.json, or name its columns after the known fields (issue, agent, model, outcome, minutes, cost...).',
    );
  }
  return importFacts(text, mapping);
}

function parseMessages(raw: string): Array<CommitMessage & { parents: string[]; time: number }> {
  return raw
    .split("\u0001")
    .filter((c) => c.trim() !== "")
    .map((c) => {
      const [hash = "", parents = "", time = "0", subject = "", body = ""] = c.split("\u0002");
      return {
        hash: hash.trim(),
        parents: parents.split(" ").filter(Boolean),
        time: Number(time),
        subject,
        body: body.trim(),
      };
    });
}

const MESSAGE_FORMAT = "--format=%x01%H%x02%P%x02%ct%x02%s%x02%b";

/**
 * Issue mode: walks the first-parent history, links each step to an issue (specification 6.4) and returns one
 * frame per issue, at the last commit linked to it. Commits linked to no issue are grouped per day.
 */
async function planIssueFrames(
  topLevel: string,
  opts: TimelineOptions,
  branch: string,
  forge: ForgeData | undefined,
  patterns: readonly string[],
): Promise<{ revs: Rev[]; coverage: CoverageReport }> {
  const args = ["log", "--first-parent", "--reverse", MESSAGE_FORMAT];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  args.push(opts.range ?? branch);
  const chain = parseMessages(await git(topLevel, args));
  const coverage = emptyCoverage(forge !== undefined);
  const byIssue = new Map<number, { index: number; rev: Rev }>();
  const unlinkedByDay = new Map<string, { index: number; rev: Rev }>();

  for (const [index, step] of chain.entries()) {
    const [first, second] = step.parents;
    const merged =
      first && second
        ? parseMessages(await git(topLevel, ["log", MESSAGE_FORMAT, `${first}..${second}`]))
        : [];
    const link = linkStep(step, merged, forge, patterns);
    const size = 1 + merged.length;
    coverage.commits += size;
    coverage.byStrategy[link.strategy] += size;
    const subjects = [step.subject, ...merged.map((m) => m.subject)];
    if (link.issue === undefined) {
      const day = new Date(step.time * 1000).toISOString().slice(0, 10);
      unlinkedByDay.set(day, {
        index,
        rev: {
          hash: step.hash,
          time: step.time,
          subject: step.subject,
          meta: { label: `unlinked ${day}`, kind: "unknown", unlinked: true },
        },
      });
      continue;
    }
    coverage.linked += size;
    const issue = frameIssue(link.issue, link.pullRequest, forge);
    const kind =
      subjects.map((s) => kindOf(s, link.branch, issue.labels)).find((k) => k !== "unknown") ?? "unknown";
    byIssue.set(link.issue, {
      index,
      rev: {
        hash: step.hash,
        time: step.time,
        subject: step.subject,
        meta: { label: issue.title ? `#${issue.number} ${issue.title}` : `#${issue.number}`, kind, issue },
      },
    });
  }
  coverage.issues = byIssue.size;
  const frames = [...byIssue.values(), ...unlinkedByDay.values()].sort((a, b) => a.index - b.index);
  return { revs: frames.map((f) => f.rev), coverage };
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
  // what the manifest says: the name of the branch checked out, not the word HEAD
  const branchName = await branchLabel(repo.topLevel, branch);
  const mode: TimelineMode = opts.mode ?? (opts.revs?.length ? "revs" : opts.by);
  const config = await loadConfig(folder);
  const planWarnings: string[] = [];
  let coverage: CoverageReport | undefined;
  let revs: Rev[];
  let forge: ForgeData | undefined;
  if (mode === "issue") {
    if (!opts.offline) {
      try {
        forge = await loadForge(opts.gh ?? systemGh(folder), join(dataDir, "cache", "forge.json"));
      } catch (err) {
        planWarnings.push(
          `GitHub data could not be loaded (${err instanceof Error ? err.message : String(err)}): issue titles are unavailable. Issues are still found from commit messages and branch names.`,
        );
      }
    }
    const plan = await planIssueFrames(repo.topLevel, opts, branch, forge, config.issuePatterns);
    revs = plan.revs;
    coverage = plan.coverage;
  } else {
    revs = await listRevs(repo.topLevel, opts, branch);
    if (mode === "day") revs = lastOfEachDay(revs);
  }
  if (revs.length === 0) throw new Error("No commit matches the given branch, range or dates.");
  const total = revs.length;
  revs = sample(revs, opts.maxFrames);

  const tip = revs[revs.length - 1] as Rev;
  const scope = scopeOf(repo.prefix, opts.path);
  const log = await loadHistoryLog(repo.topLevel, opts.revs?.length ? "--all" : tip.hash, scope);
  const byHash = new Map(log.commits.map((c) => [c.hash, c]));
  const cachePath = join(dataDir, "cache", "files.json");
  const fileCache = await loadFileCache(cachePath);
  const cachedBefore = fileCache.size;
  let reachable = new Set<string>();
  let lineage: Lineage | undefined;
  try {
    lineage = await buildLineage(repo.topLevel, tip.hash, {
      config,
      forge,
      prefix: repo.prefix,
      scope,
      checkpoints: revs.map((r) => r.hash),
      cachePath: join(dataDir, "cache", `provenance.${mode}.json`),
      analyzerVersion: ANALYZER_VERSION,
    });
    if (revs.some((r) => !lineage?.stepIndex.has(r.hash))) {
      planWarnings.push(
        "Some frames are not on the first-parent history: rework and authorship are unavailable for them.",
      );
    }
  } catch (err) {
    planWarnings.push(
      `Line provenance could not be computed (${err instanceof Error ? err.message : String(err)}): rework and authorship are unavailable.`,
    );
  }
  const known = lineage;
  const shared: AnalyzeShared = {
    provenance: (hash) => (known ? { metrics: known.at.get(hash), labels: known.labels } : undefined),
    config,
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
  const facts = await loadFacts(folder, opts.facts, config);
  const costByFile = new Map<string, number>();
  const dimensions = resolveDimensions(config.thresholds);
  let previousHealth: FrameHealth | undefined;
  let previousShortcuts = 0;

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
    const health = frameHealth(result.files, dimensions);
    const shortcutCount = result.files.reduce((sum, f) => sum + (f.values.escape_hatches ?? 0), 0);
    const quality =
      previousHealth === undefined
        ? {}
        : {
            quality_delta: Math.round((health.score - previousHealth.score) * 10) / 10,
            hotspots_created: health.hotspots.filter((p) => !previousHealth?.hotspots.includes(p)).length,
            hotspots_resolved: previousHealth.hotspots.filter((p) => !health.hotspots.includes(p)).length,
            shortcuts_added: shortcutCount - previousShortcuts,
          };
    previousHealth = health;
    previousShortcuts = shortcutCount;
    const short = rev.hash.slice(0, 8);
    const id = `${String(index + 1).padStart(4, "0")}-${short}`;
    const date = new Date(rev.time * 1000).toISOString();
    if (facts) {
      // experimental: the cost of the issues that touched each file, split by the lines each one changed there
      const number = rev.meta?.issue?.number;
      const fact = facts.facts.find(
        (f) =>
          (number !== undefined && f.issue === number) ||
          (f.commit !== undefined && rev.hash.startsWith(f.commit)),
      );
      addCostShares(costByFile, lines, fact?.cost);
      if (costByFile.size > 0) {
        const lens = result.snapshot.lenses.metrics;
        for (const [path, cost] of costByFile) {
          const values = lens.attributes[nodeId(`/root/${path}`)];
          if (values) values.cost_share = Math.round(cost * 100) / 100;
        }
        lens.attributeDescriptors.cost_share = {
          title: "Cost share",
          description: "Cost of the issues that touched the file",
          analyzers: ["factory-city"],
        };
        lens.attributeTypes.cost_share = "absolute";
        result.snapshot.meta.checksum = bodyChecksum(result.snapshot.files, result.snapshot.lenses);
        metrics.add("cost_share");
      }
    }
    await writeAtomic(join(framesDir, `${id}.cc.json`), JSON.stringify(result.snapshot));
    frames.push({
      id,
      index,
      kind: rev.meta?.kind ?? kindOfSubject(rev.subject),
      label: rev.meta?.label ?? (mode === "day" ? date.slice(0, 10) : `${short.slice(0, 7)} ${rev.subject}`),
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
        ...quality,
      },
      health,
      lines,
      ...(rev.meta?.issue ? { issue: rev.meta.issue } : {}),
      ...(rev.meta?.unlinked ? { unlinked: true } : {}),
    });
    previousBlobs = result.blobs;
    previousReachable = reachable;
    opts.onProgress?.(index + 1, revs.length);
  }

  if (!last) throw new Error("No frame was produced.");
  if (facts) await writeAtomic(join(dataDir, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
  if (lineage) {
    // retrospective metrics: what later happened to the lines each frame added
    let previous = -1;
    for (const [i, rev] of revs.entries()) {
      const at = lineage.stepIndex.get(rev.hash);
      const frame = frames[i];
      if (at === undefined || !frame) continue;
      const indices: number[] = [];
      for (let k = previous + 1; k <= at; k++) indices.push(k);
      previous = Math.max(previous, at);
      const retro = lineage.provenance.retrospective(indices, rev.time);
      frame.metrics.caused_fixes = retro.caused_fixes;
      frame.metrics.lines_written = retro.lines_added;
      if (retro.alive_30 !== undefined) frame.metrics.alive_30 = retro.alive_30;
      if (retro.alive_90 !== undefined) frame.metrics.alive_90 = retro.alive_90;
      if (retro.rework_after !== undefined) frame.metrics.rework_after = retro.rework_after;
      else if (retro.lines_added > 0) frame.metrics.rework_after_pending = true;
    }
  }
  enrichFrames(frames, { forge, facts, estimatePatterns: config.estimatePatterns });
  const manifest: TimelineManifest = {
    kind: "timeline",
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    createdAt: new Date().toISOString(),
    project: basename(folder),
    source: {
      mode,
      branch: opts.range ?? branchName,
      firstParent: !opts.allCommits && !opts.revs?.length,
      ...(total !== revs.length ? { sampledFrom: total } : {}),
    },
    dataLevel: facts ? 3 : forge ? 2 : last.manifest.dataLevel,
    git: last.manifest.git,
    metrics: [...metrics].sort(),
    categories: last.manifest.categories,
    ignored: last.manifest.ignored,
    warnings: [...planWarnings, ...warnings],
    ...(coverage ? { coverage } : {}),
    frames,
  };
  await writeAtomic(join(dataDir, `timeline.${mode}.json`), `${JSON.stringify(manifest)}\n`);
  if (mode === "issue") {
    const factory = computeFactory({
      project: manifest.project,
      analyzerVersion: ANALYZER_VERSION,
      dataLevel: manifest.dataLevel,
      frames,
    });
    await writeAtomic(join(dataDir, "factory.json"), `${JSON.stringify(factory, null, 2)}\n`);
  }
  await writeAtomic(join(dataDir, `report.${mode}.json`), `${JSON.stringify(last.report, null, 2)}\n`);
  await writeAtomic(cachePath, JSON.stringify({ version: ANALYZER_VERSION, entries: [...fileCache] }));
  return {
    manifest,
    dataDir,
    cache: { parsed: fileCache.size - cachedBefore, reused: Math.max(0, lookups) },
    provenance: { replayed: lineage?.replayed ?? 0, reused: lineage?.reused ?? 0 },
  };
}
