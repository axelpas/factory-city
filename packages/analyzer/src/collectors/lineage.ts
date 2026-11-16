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
  const labels: string[] = [];
  const labelIndex = new Map<string, number>();
  const labelOf = steps.map((step) => {
    const label = authorLabel(step, config.authorLabels);
    let index = labelIndex.get(label);
    if (index === undefined) {
      index = labels.length;
      labels.push(label);
      labelIndex.set(label, index);
    }
    return index;
  });
  const provenance = new Provenance(steps, labelOf, labels, {
    recentDays: config.windows.recentDays,
    reworkDays: config.windows.reworkDays,
  });
  const stepIndex = new Map(steps.map((s, i) => [s.hash, i]));
  const wanted = new Set(options.checkpoints.filter((h) => stepIndex.has(h)));
  const at = new Map<string, Map<string, FileProvenance>>();

  // what the metrics depend on besides the history itself
  const key = JSON.stringify([
    options.prefix,
    options.scope ?? "",
    config.windows,
    config.fixPatterns,
    config.issuePatterns,
    config.authorLabels,
    options.forge !== undefined,
  ]);
  let reused = 0;
  if (options.cachePath) {
    try {
      const cache = JSON.parse(await readFile(options.cachePath, "utf8")) as Cache;
      const known = new Map(cache.checkpoints);
      const usable =
        cache.version === options.analyzerVersion &&
        cache.key === key &&
        // every wanted step the cache has already passed must have its metrics saved
        [...wanted].every((h) => (stepIndex.get(h) as number) >= cache.state.hashes.length || known.has(h));
      if (usable && provenance.restore(cache.state)) {
        reused = provenance.applied;
        for (const h of wanted) {
          const saved = known.get(h);
          if (saved) at.set(h, new Map(saved));
        }
      }
    } catch {
      // no cache, or unreadable: replay from the start
    }
  }

  const replayed = await replay(
    topLevel,
    provenance,
    (index) => {
      const hash = (steps[index] as Step).hash;
      if (wanted.has(hash)) at.set(hash, provenance.fileMetrics(options.prefix));
    },
    options.scope ?? "",
  );

  if (options.cachePath) {
    const cache: Cache = {
      version: options.analyzerVersion,
      key,
      state: provenance.serialize(),
      checkpoints: [...at].map(([hash, metrics]) => [hash, [...metrics]]),
    };
    await mkdir(dirname(options.cachePath), { recursive: true });
    await writeFile(options.cachePath, JSON.stringify(cache));
  }
  return { steps, labels, at, provenance, stepIndex, replayed, reused };
}
