import { basename, join } from "node:path";
import type { Facts, Frame, TimelineManifest, TimelineMode } from "@factory-city/schema";
import type { AnalysisResult } from "../analysis/types.js";
import { ANALYZER_VERSION } from "../analyze.js";
import type { ForgeData } from "../collectors/issues.js";
import { computeFactory } from "../factory/kpis.js";
import { writeAtomic } from "./io.js";
import type { FramePlan } from "./plan.js";
import type { TimelineOptions } from "./types.js";

export interface ManifestInput {
  folder: string;
  opts: TimelineOptions;
  mode: TimelineMode;
  branchName: string;
  plan: FramePlan;
  facts: Facts | undefined;
  forge: ForgeData | undefined;
  frames: Frame[];
  metrics: Set<string>;
  last: AnalysisResult;
  warnings: string[];
}

/** The manifest of a timeline: where it comes from, what it holds, and every frame. */
export function buildManifest(i: ManifestInput): TimelineManifest {
  const { opts, plan, last } = i;
  const { revs, total, coverage } = plan;
  return {
    kind: "timeline",
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    createdAt: new Date().toISOString(),
    project: basename(i.folder),
    source: {
      mode: i.mode,
      branch: opts.range ?? i.branchName,
      firstParent: !opts.allCommits && !opts.revs?.length,
      ...(total !== revs.length ? { sampledFrom: total } : {}),
    },
    dataLevel: i.facts ? 3 : i.forge ? 2 : last.manifest.dataLevel,
    git: last.manifest.git,
    metrics: [...i.metrics].sort(),
    categories: last.manifest.categories,
    ignored: last.manifest.ignored,
    warnings: i.warnings,
    ...(coverage ? { coverage } : {}),
    frames: i.frames,
  };
}

/** Writes the manifest, the factory KPIs of a per-issue timeline, and the report of the last frame. */
export async function writeOutputs(
  dataDir: string,
  mode: TimelineMode,
  manifest: TimelineManifest,
  last: AnalysisResult,
): Promise<void> {
  await writeAtomic(join(dataDir, `timeline.${mode}.json`), `${JSON.stringify(manifest)}\n`);
  if (mode === "issue") {
    const factory = computeFactory({
      project: manifest.project,
      analyzerVersion: ANALYZER_VERSION,
      dataLevel: manifest.dataLevel,
      frames: manifest.frames,
    });
    await writeAtomic(join(dataDir, "factory.json"), `${JSON.stringify(factory, null, 2)}\n`);
  }
  await writeAtomic(join(dataDir, `report.${mode}.json`), `${JSON.stringify(last.report, null, 2)}\n`);
}
