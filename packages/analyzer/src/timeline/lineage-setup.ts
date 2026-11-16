import { join } from "node:path";
import { ANALYZER_VERSION } from "../analyze.js";
import type { ForgeData } from "../collectors/issues.js";
import { buildLineage, type Lineage } from "../collectors/lineage.js";
import type { Config } from "../config.js";
import type { Rev } from "./types.js";

export interface LineageInput {
  topLevel: string;
  revs: readonly Rev[];
  tip: Rev;
  config: Config;
  forge: ForgeData | undefined;
  prefix: string;
  scope: string;
  dataDir: string;
  mode: string;
}

/** Line provenance for the frames; when it cannot be computed, the timeline goes on without it and says so. */
export async function loadLineage(input: LineageInput): Promise<{ lineage?: Lineage; warnings: string[] }> {
  const { topLevel, revs, tip, config, forge, prefix, scope, dataDir, mode } = input;
  try {
    const lineage = await buildLineage(topLevel, tip.hash, {
      config,
      forge,
      prefix,
      scope,
      checkpoints: revs.map((r) => r.hash),
      cachePath: join(dataDir, "cache", `provenance.${mode}.json`),
      analyzerVersion: ANALYZER_VERSION,
    });
    const offHistory = revs.some((r) => !lineage.stepIndex.has(r.hash));
    return {
      lineage,
      warnings: offHistory
        ? ["Some frames are not on the first-parent history: rework and authorship are unavailable for them."]
        : [],
    };
  } catch (err) {
    return {
      warnings: [
        `Line provenance could not be computed (${err instanceof Error ? err.message : String(err)}): rework and authorship are unavailable.`,
      ],
    };
  }
}
