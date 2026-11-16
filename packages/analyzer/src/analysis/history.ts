import { resolve } from "node:path";
import { collectHistory, historyMetrics } from "../collectors/history.js";
import { buildLineage } from "../collectors/lineage.js";
import { loadConfig } from "../config.js";
import { type RepoInfo, revParse, scopeOf } from "../source/git.js";
import { ANALYZER_VERSION } from "./constants.js";
import type { AnalyzeOptions, FileValues } from "./types.js";

export interface HistoryOutcome {
  /** 1 when the history could be read, else 0. */
  dataLevel: 0 | 1;
  coChange: Array<[string, string]>;
  /** Author labels, in order of first appearance: the code of `main_agent` is an index in this list. */
  authorLabels?: string[];
}

/** Level 1, from `git log`: change, fixes and change coupling, up to the analyzed revision and never beyond it. */
async function addCommitHistory(
  opts: AnalyzeOptions,
  repo: RepoInfo,
  attributesByPath: FileValues,
  warnings: string[],
): Promise<Pick<HistoryOutcome, "dataLevel" | "coChange">> {
  try {
    const config = await loadConfig(resolve(opts.folder));
    const files = new Set(attributesByPath.keys());
    const rev = opts.rev ?? "HEAD";
    const history = opts.shared?.history
      ? await opts.shared.history(rev, files)
      : await collectHistory(
          repo.topLevel,
          repo.prefix,
          rev,
          files,
          { recentDays: config.windows.recentDays, fixPatterns: config.fixPatterns },
          scopeOf(repo.prefix, opts.path),
        );
    for (const [path, h] of history.files) {
      const values = attributesByPath.get(path);
      if (values) Object.assign(values, historyMetrics(h, history.snapshotTime));
    }
    return { dataLevel: 1, coChange: history.coupled };
  } catch (err) {
    warnings.push(
      `Git history could not be read (${err instanceof Error ? err.message : String(err)}): level 1 metrics are unavailable.`,
    );
    return { dataLevel: 0, coChange: [] };
  }
}

/** Level 1, from line provenance: rework, contention and authorship. Returns the author labels. */
async function addProvenance(
  opts: AnalyzeOptions,
  repo: RepoInfo,
  attributesByPath: FileValues,
  warnings: string[],
): Promise<string[] | undefined> {
  try {
    const hash = await revParse(repo.topLevel, opts.rev ?? "HEAD");
    let found = opts.shared?.provenance?.(hash);
    if (!opts.shared?.provenance) {
      const lineage = await buildLineage(repo.topLevel, hash, {
        config: await loadConfig(resolve(opts.folder)),
        prefix: repo.prefix,
        scope: scopeOf(repo.prefix, opts.path),
        checkpoints: [hash],
        analyzerVersion: ANALYZER_VERSION,
      });
      found = { metrics: lineage.at.get(hash), labels: lineage.labels };
    }
    if (!found?.metrics) return undefined;
    for (const [path, m] of found.metrics) {
      const values = attributesByPath.get(path);
      if (!values) continue;
      values.rework_lines = m.rework_lines;
      values.rework_ratio = m.rework_ratio;
      values.issues_recent = m.issues_recent;
      if (m.main_agent >= 0) {
        values.main_agent = m.main_agent;
        values.main_agent_share = m.main_agent_share;
      }
    }
    return found.labels;
  } catch (err) {
    warnings.push(
      `Line provenance could not be computed (${err instanceof Error ? err.message : String(err)}): rework and authorship are unavailable.`,
    );
    return undefined;
  }
}

/** Everything git knows about the files, when the folder is a repository with commits. */
export async function addHistory(
  opts: AnalyzeOptions,
  repo: RepoInfo | undefined,
  attributesByPath: FileValues,
  warnings: string[],
): Promise<HistoryOutcome> {
  if (!repo?.hasCommits) return { dataLevel: 0, coChange: [] };
  const commits = await addCommitHistory(opts, repo, attributesByPath, warnings);
  const authorLabels = await addProvenance(opts, repo, attributesByPath, warnings);
  return { ...commits, ...(authorLabels ? { authorLabels } : {}) };
}
