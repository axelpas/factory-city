import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TimelineMode } from "@factory-city/schema";
import type { AnalyzeShared } from "./analyze.js";
import { ANALYZER_VERSION, analyze } from "./analyze.js";
import { enrichFrames } from "./collectors/enrich.js";
import { computeHistory, loadHistoryLog, reachableCommits } from "./collectors/history.js";
import { loadConfig } from "./config.js";
import { resolveDimensions } from "./health/dimensions.js";
import { findRepo, scopeOf } from "./source/git.js";
import { addRetrospective } from "./timeline/frame.js";
import { loadFacts, loadFileCache, writeAtomic } from "./timeline/io.js";
import { loadLineage } from "./timeline/lineage-setup.js";
import { buildManifest, writeOutputs } from "./timeline/manifest.js";
import { branchLabel, planFrames } from "./timeline/plan.js";
import { FrameRecorder } from "./timeline/recorder.js";
import type { Rev, TimelineOptions, TimelineResult } from "./timeline/types.js";

export { branchLabel, kindOfSubject, lastOfEachDay, sample } from "./timeline/plan.js";
export type { TimelineOptions, TimelineResult } from "./timeline/types.js";

/** The repository a timeline is built from, or why there is none. */
async function openRepository(folder: string) {
  const repo = await findRepo(folder);
  if (!repo)
    throw new Error(
      `A timeline needs a git repository, but ${folder} is not inside one. Use \`factory-city analyze\` for a plain folder.`,
    );
  if (!repo.hasCommits) throw new Error("This repository has no commit yet: there is no history to play.");
  return repo;
}

/**
 * Builds a timeline: one snapshot per frame, each analyzed from the object database at its own revision.
 * Every unique file content is parsed once (cache by blob id and analyzer version); the git log is read once.
 */
export async function buildTimeline(opts: TimelineOptions, dataDir: string): Promise<TimelineResult> {
  const folder = resolve(opts.folder);
  const repo = await openRepository(folder);
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
  const { revs, forge } = plan;

  const tip = revs[revs.length - 1] as Rev;
  const log = await loadHistoryLog(repo.topLevel, opts.revs?.length ? "--all" : tip.hash, scope);
  const cachePath = join(dataDir, "cache", "files.json");
  const fileCache = await loadFileCache(cachePath);
  const cachedBefore = fileCache.size;
  const { lineage, warnings: lineageWarnings } = await loadLineage({
    topLevel: repo.topLevel,
    revs,
    tip,
    config,
    forge,
    prefix: repo.prefix,
    scope,
    dataDir,
    mode,
  });
  let reachable = new Set<string>();
  let currentTime = 0;
  const shared: AnalyzeShared = {
    provenance: (hash) => (lineage ? { metrics: lineage.at.get(hash), labels: lineage.labels } : undefined),
    config,
    fileCache,
    history: async (_rev, files) =>
      computeHistory(log, currentTime, reachable, repo.prefix, files, {
        recentDays: config.windows.recentDays,
        fixPatterns: config.fixPatterns,
      }),
  };

  const framesDir = join(dataDir, `frames.${mode}`);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(join(dataDir, "cache"), { recursive: true });

  const facts = await loadFacts(folder, opts.facts, config);
  const metrics = new Set<string>();
  const warnings = new Set<string>();
  const recorder = new FrameRecorder({
    framesDir,
    mode,
    prefix: repo.prefix,
    byHash: new Map(log.commits.map((c) => [c.hash, c])),
    facts,
    dimensions: resolveDimensions(config.thresholds),
    metrics,
  });
  const frames = [];
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
    frames.push(await recorder.record({ index, rev, result, reachable }));
    opts.onProgress?.(index + 1, revs.length);
  }

  if (!last) throw new Error("No frame was produced.");
  if (facts) await writeAtomic(join(dataDir, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
  if (lineage) addRetrospective(frames, revs, lineage);
  enrichFrames(frames, { forge, facts, estimatePatterns: config.estimatePatterns });
  const manifest = buildManifest({
    folder,
    opts,
    mode,
    branchName,
    plan,
    facts,
    forge,
    frames,
    metrics,
    last,
    warnings: [...plan.warnings, ...lineageWarnings, ...warnings],
  });
  await writeOutputs(dataDir, mode, manifest, last);
  await writeAtomic(cachePath, JSON.stringify({ version: ANALYZER_VERSION, entries: [...fileCache] }));
  return {
    manifest,
    dataDir,
    cache: { parsed: fileCache.size - cachedBefore, reused: Math.max(0, lookups) },
    provenance: { replayed: lineage?.replayed ?? 0, reused: lineage?.reused ?? 0 },
  };
}
