import type { AnalysisManifest, CcJson, Frame, TimelineManifest } from "@factory-city/schema";
import type { MetricDefinition } from "@factory-city/schema/registry";
import { buildModel, type Model } from "./model";
import { shareStatistics } from "./shared-stats";

export interface FrameData {
  /** Timeline information; undefined for a single snapshot. */
  info?: Frame;
  model: Model;
  /** Union index of each file of the model. */
  unionIndex: Int32Array;
  /** Model index of each union file, -1 when the file does not exist in this frame. */
  modelIndex: Int32Array;
}

/** Everything the viewer shows: one frame for a snapshot, many for a timeline, over one fixed set of files. */
export interface TimelineData {
  project: string;
  manifest?: AnalysisManifest | TimelineManifest;
  /** Every file path of any frame, sorted: the union that owns the parcels. */
  paths: string[];
  pathIndex: Map<string, number>;
  frames: FrameData[];
  metrics: Map<string, MetricDefinition>;
  /** First and last frame where each union file exists. */
  firstFrame: Int32Array;
  lastFrame: Int32Array;
}

const CHANGE_METRIC: MetricDefinition = {
  id: "@change",
  label: "Change since the previous frame",
  definition: "What the frame did to the file: added, grown, shrunk or removed.",
  computation: "The ground-area metric of the file in this frame minus its value in the previous frame.",
  why: "Shows what a step, an issue or a branch did to the city.",
  unit: "",
  direction: "neutral",
  kind: "number",
  scope: "file",
  level: 1,
  limits: "Compares two frames only; a file that changed without growing or shrinking shows as unchanged.",
  experimental: false,
  retrospective: false,
};

/** The snapshot manifest the models are built with: the one given, or one made from a timeline's manifest. */
function snapshotManifest(
  manifest: AnalysisManifest | TimelineManifest | undefined,
): AnalysisManifest | undefined {
  if (!manifest || manifest.kind === "snapshot") return manifest;
  return {
    kind: "snapshot",
    schemaVersion: 1,
    analyzerVersion: manifest.analyzerVersion,
    createdAt: manifest.createdAt,
    project: manifest.project,
    source: { kind: "git" },
    dataLevel: manifest.dataLevel,
    git: manifest.git,
    metrics: manifest.metrics,
    categories: manifest.categories,
    selected: 0,
    analyzed: 0,
    ignored: manifest.ignored,
    warnings: manifest.warnings,
    snapshot: "",
  };
}

/**
 * Builds the viewer's data. Statistics are computed over all frames, so that scales stay fixed while the
 * timeline plays.
 */
export function buildTimelineData(
  snapshots: readonly CcJson[],
  manifest?: AnalysisManifest | TimelineManifest,
): TimelineData {
  const frameInfos = manifest?.kind === "timeline" ? manifest.frames : undefined;
  const shared = snapshotManifest(manifest);
  const models = snapshots.map((cc) => buildModel(cc, shared));
  const paths = [...new Set(models.flatMap((m) => m.files.map((f) => f.path)))].sort();
  const pathIndex = new Map(paths.map((p, i) => [p, i]));
  const firstFrame = new Int32Array(paths.length).fill(-1);
  const lastFrame = new Int32Array(paths.length).fill(-1);

  const metrics = new Map<string, MetricDefinition>();
  const frames: FrameData[] = models.map((model, f) => {
    for (const [id, def] of model.metrics) metrics.set(id, def);
    const unionIndex = new Int32Array(model.files.length);
    const modelIndex = new Int32Array(paths.length).fill(-1);
    model.files.forEach((file, i) => {
      const u = pathIndex.get(file.path) as number;
      unionIndex[i] = u;
      modelIndex[u] = i;
      if (firstFrame[u] === -1) firstFrame[u] = f;
      lastFrame[u] = f;
    });
    return { info: frameInfos?.[f], model, unionIndex, modelIndex };
  });

  if (models.length > 1) {
    shareStatistics(models, metrics);
    // the Change preset colors by what each frame did: available as soon as there is a previous frame
    metrics.set(CHANGE_METRIC.id, CHANGE_METRIC);
    for (const m of models) m.coverage.set(CHANGE_METRIC.id, 1);
  }

  return {
    project: manifest?.project ?? snapshots[0]?.meta.projectName ?? "project",
    manifest,
    paths,
    pathIndex,
    frames,
    metrics,
    firstFrame,
    lastFrame,
  };
}

export { layoutWeights } from "./layout-weights";
