import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import { authorLabel } from "./authors.js";
import type { ForgeData } from "./issues.js";
import { type FileProvenance, Provenance, replay } from "./provenance.js";
import { loadSteps, type Step } from "./steps.js";

export interface LineageOptions {
  config: Config;
  forge?: ForgeData;
  /** Folder of the analysis inside the repository ("" for the root): file paths are relative to it. */
  prefix: string;
  /** A folder of the repository to narrow the diffs to (the prefix and `--path` joined); "" for all of it. */
  scope?: string;
  /** Hashes of the steps whose file metrics are wanted (the frames). */
  checkpoints: readonly string[];
  /** Where to keep the state between runs, so that extending a timeline replays only the new steps. */
  cachePath?: string;
  analyzerVersion: string;
}

export interface Lineage {
  steps: Step[];
  /** Author labels, in order of first appearance: the code of `main_agent` is an index in this list. */
  labels: string[];
  /** File metrics at each checkpoint that lies on the first-parent history. */
  at: Map<string, Map<string, FileProvenance>>;
  provenance: Provenance;
  stepIndex: Map<string, number>;
  /** Steps replayed in this run, and steps restored from the cache. */
  replayed: number;
  reused: number;
}

interface Cache {
  version: string;
  key: string;
  state: ReturnType<Provenance["serialize"]>;
  checkpoints: Array<[string, Array<[string, FileProvenance]>]>;
}

/** The author label of each step, as an index in the list of labels in order of first appearance. */
function labelSteps(steps: readonly Step[], authorLabels: Config["authorLabels"]) {
  const labels: string[] = [];
  const labelIndex = new Map<string, number>();
  const labelOf = steps.map((step) => {
    const label = authorLabel(step, authorLabels);
    let index = labelIndex.get(label);
    if (index === undefined) {
      index = labels.length;
      labels.push(label);
      labelIndex.set(label, index);
    }
    return index;
  });
  return { labels, labelOf };
}

/** What the metrics depend on besides the history itself. */
function cacheKeyOf(options: LineageOptions): string {
  const { config } = options;
  return JSON.stringify([
    options.prefix,
    options.scope ?? "",
    config.windows,
    config.fixPatterns,
    config.issuePatterns,
    config.authorLabels,
    options.forge !== undefined,
  ]);
}

/**
 * Restores the state saved by a previous run, when it still applies to this history and these frames.
 * Returns how many steps were restored, and fills `at` with the metrics saved for the wanted steps.
 */
async function restoreCache(
  options: LineageOptions,
  key: string,
  provenance: Provenance,
  wanted: ReadonlySet<string>,
  stepIndex: ReadonlyMap<string, number>,
  at: Map<string, Map<string, FileProvenance>>,
): Promise<number> {
  if (!options.cachePath) return 0;
  try {
    const cache = JSON.parse(await readFile(options.cachePath, "utf8")) as Cache;
    const known = new Map(cache.checkpoints);
    const usable =
      cache.version === options.analyzerVersion &&
      cache.key === key &&
      // every wanted step the cache has already passed must have its metrics saved
      [...wanted].every((h) => (stepIndex.get(h) as number) >= cache.state.hashes.length || known.has(h));
    if (!usable || !provenance.restore(cache.state)) return 0;
    for (const h of wanted) {
      const saved = known.get(h);
      if (saved) at.set(h, new Map(saved));
    }
    return provenance.applied;
  } catch {
    // no cache, or unreadable: replay from the start
    return 0;
  }
}

async function saveCache(
  options: LineageOptions,
  key: string,
  provenance: Provenance,
  at: ReadonlyMap<string, Map<string, FileProvenance>>,
): Promise<void> {
  if (!options.cachePath) return;
  const cache: Cache = {
    version: options.analyzerVersion,
    key,
    state: provenance.serialize(),
    checkpoints: [...at].map(([hash, metrics]) => [hash, [...metrics]]),
  };
  await mkdir(dirname(options.cachePath), { recursive: true });
  await writeFile(options.cachePath, JSON.stringify(cache));
}

/**
 * Line provenance of a revision's first-parent history, with the file metrics at the wanted steps.
 * One replay serves every frame of a timeline.
 */
export async function buildLineage(topLevel: string, rev: string, options: LineageOptions): Promise<Lineage> {
  const { config } = options;
  const steps = await loadSteps(topLevel, rev, {
    forge: options.forge,
    issuePatterns: config.issuePatterns,
    fixPatterns: config.fixPatterns,
  });
  const { labels, labelOf } = labelSteps(steps, config.authorLabels);
  const provenance = new Provenance(steps, labelOf, labels, {
    recentDays: config.windows.recentDays,
    reworkDays: config.windows.reworkDays,
  });
  const stepIndex = new Map(steps.map((s, i) => [s.hash, i]));
  const wanted = new Set(options.checkpoints.filter((h) => stepIndex.has(h)));
  const at = new Map<string, Map<string, FileProvenance>>();
  const key = cacheKeyOf(options);
  const reused = await restoreCache(options, key, provenance, wanted, stepIndex, at);
  const replayed = await replay(
    topLevel,
    provenance,
    (index) => {
      const hash = (steps[index] as Step).hash;
      if (wanted.has(hash)) at.set(hash, provenance.fileMetrics(options.prefix));
    },
    options.scope ?? "",
  );
  await saveCache(options, key, provenance, at);
  return { steps, labels, at, provenance, stepIndex, replayed, reused };
}
