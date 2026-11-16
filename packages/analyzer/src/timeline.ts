import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Facts, Frame, FrameHealth, TimelineManifest, TimelineMode } from "@factory-city/schema";
import type { AnalyzeShared, CachedFile } from "./analyze.js";
import { ANALYZER_VERSION, analyze } from "./analyze.js";
import { addCostShares, enrichFrames } from "./collectors/enrich.js";
import { autoMapping, importFacts } from "./collectors/facts.js";
import { computeHistory, loadHistoryLog, reachableCommits } from "./collectors/history.js";
import { buildLineage, type Lineage } from "./collectors/lineage.js";
import { type Config, loadConfig } from "./config.js";
import { computeFactory } from "./factory/kpis.js";
import { resolveDimensions } from "./health/dimensions.js";
import { frameHealth } from "./health/health.js";
import { findRepo, scopeOf } from "./source/git.js";

import {
  addRetrospective,
  diffBlobs,
  factOf,
  lineChanges,
  qualityChange,
  snapshotTotals,
  writeCostShares,
} from "./timeline/frame.js";
import { branchLabel, kindOfSubject, planFrames } from "./timeline/plan.js";
import type { Rev, TimelineOptions, TimelineResult } from "./timeline/types.js";

export { branchLabel, kindOfSubject, lastOfEachDay, sample } from "./timeline/plan.js";
export type { TimelineOptions, TimelineResult } from "./timeline/types.js";

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
  // the folder this timeline is about, from the root of the repository: "" for all of it
  const scope = scopeOf(repo.prefix, opts.path);
  const config = await loadConfig(folder);
  const plan = await planFrames({
    topLevel: repo.topLevel,
    folder,
    dataDir,
    opts,
    mode,
    branch,
    scope,
    config,
  });
  const { revs, total, coverage, forge } = plan;
  const planWarnings = [...plan.warnings];

  const tip = revs[revs.length - 1] as Rev;
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

    const { added, modified, deleted } = diffBlobs(result.blobs, previousBlobs);
    const newCommits = [...reachable].filter((h) => !previousReachable.has(h));
    const { linesAdded, linesDeleted, lines } =
      index > 0
        ? lineChanges(newCommits, byHash, repo.prefix, result.blobs, previousBlobs)
        : { linesAdded: 0, linesDeleted: 0, lines: {} };
    const touched = [...added, ...modified, ...deleted];
    const folders = new Set(touched.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")));
    const totals = snapshotTotals(result.snapshot);
    const health = frameHealth(result.files, dimensions);
    const shortcutCount = result.files.reduce((sum, f) => sum + (f.values.escape_hatches ?? 0), 0);
    const quality = qualityChange(health, shortcutCount, previousHealth, previousShortcuts);
    previousHealth = health;
    previousShortcuts = shortcutCount;
    const short = rev.hash.slice(0, 8);
    const id = `${String(index + 1).padStart(4, "0")}-${short}`;
    const date = new Date(rev.time * 1000).toISOString();
    if (facts) {
      // experimental: the cost of the issues that touched each file, split by the lines each one changed there
      const fact = factOf(facts, rev);
      addCostShares(costByFile, lines, fact?.cost);
      if (costByFile.size > 0) {
        writeCostShares(result.snapshot, costByFile);
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
  if (lineage) addRetrospective(frames, revs, lineage);
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
