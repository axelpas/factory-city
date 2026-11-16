import { join } from "node:path";
import type { CoverageReport, TimelineMode } from "@factory-city/schema";
import { loadForge, systemGh } from "../collectors/forge.js";
import type { ForgeData } from "../collectors/issues.js";
import type { Config } from "../config.js";
import { planIssueFrames } from "./issue-plan.js";
import { lastOfEachDay, listRevs, sample } from "./revs.js";
import type { Rev, TimelineOptions } from "./types.js";

export { planIssueFrames } from "./issue-plan.js";
export { kindOfSubject } from "./kinds.js";
export { branchLabel, git, lastOfEachDay, listRevs, sample } from "./revs.js";

/** The frames of a timeline, picked and sampled, and what is known about how they were found. */
export interface FramePlan {
  revs: Rev[];
  /** How many frames there were before sampling. */
  total: number;
  coverage?: CoverageReport;
  forge?: ForgeData;
  warnings: string[];
}

/** Picks the revisions that become frames, from the history, by commit, by day or by issue. */
export async function planFrames(input: {
  topLevel: string;
  folder: string;
  dataDir: string;
  opts: TimelineOptions;
  mode: TimelineMode;
  branch: string;
  /** The folder the timeline is about, from the root of the repository: "" for all of it. */
  scope: string;
  config: Config;
}): Promise<FramePlan> {
  const { topLevel, folder, dataDir, opts, mode, branch, scope, config } = input;
  const warnings: string[] = [];
  let revs: Rev[];
  let coverage: CoverageReport | undefined;
  let forge: ForgeData | undefined;
  if (mode === "issue") {
    if (!opts.offline) {
      try {
        forge = await loadForge(opts.gh ?? systemGh(folder), join(dataDir, "cache", "forge.json"));
      } catch (err) {
        warnings.push(
          `GitHub data could not be loaded (${err instanceof Error ? err.message : String(err)}): issue titles are unavailable. Issues are still found from commit messages and branch names.`,
        );
      }
    }
    const plan = await planIssueFrames(topLevel, opts, branch, forge, config.issuePatterns, scope);
    revs = plan.revs;
    coverage = plan.coverage;
  } else {
    revs = await listRevs(topLevel, opts, branch, scope);
    if (mode === "day") revs = lastOfEachDay(revs);
  }
  if (revs.length === 0) throw new Error("No commit matches the given branch, range or dates.");
  return {
    revs: sample(revs, opts.maxFrames),
    total: revs.length,
    ...(coverage ? { coverage } : {}),
    ...(forge ? { forge } : {}),
    warnings,
  };
}
