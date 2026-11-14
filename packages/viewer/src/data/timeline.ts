import type { AnalysisManifest, CcJson, Frame, TimelineManifest } from "@factory-city/schema";
import type { MetricDefinition } from "@factory-city/schema/registry";
import { buildModel, type MetricStats, type Model, statsOf } from "./model";

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

/** A map whose values are computed the first time they are asked for. */
class LazyMap<V> extends Map<string, V> {
  constructor(
    private readonly keysKnown: ReadonlySet<string>,
    private readonly compute: (key: string) => V,
  ) {
    super();
  }
  override has(key: string): boolean {
    return this.keysKnown.has(key);
  }
  override get(key: string): V | undefined {
    if (!this.keysKnown.has(key)) return undefined;
    if (!super.has(key)) super.set(key, this.compute(key));
    return super.get(key);
  }
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
  const shared: AnalysisManifest | undefined =
    manifest?.kind === "snapshot"
      ? manifest
      : manifest
        ? {
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
          }
        : undefined;
  const models = snapshots.map((cc) => buildModel(cc, shared));

  const pathSet = new Set<string>();
  for (const m of models) for (const f of m.files) pathSet.add(f.path);
  const paths = [...pathSet].sort();
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
    const fileIds = new Set<string>();
    const folderIds = new Set<string>();
    for (const m of models) {
      for (const id of m.stats.keys()) fileIds.add(id);
      for (const id of m.folderStats.keys()) folderIds.add(id);
    }
    const stats = new LazyMap<MetricStats>(fileIds, (id) => {
      const values: number[] = [];
      for (const m of models)
        for (const f of m.files) if (f.values[id] !== undefined) values.push(f.values[id] as number);
      return statsOf(values);
    });
    const folderStats = new LazyMap<MetricStats>(folderIds, (id) => {
      const values: number[] = [];
      for (const m of models) {
        for (const folder of m.folders.values())
          if (folder.depth > 0 && folder.values[id] !== undefined) values.push(folder.values[id] as number);
      }
      return statsOf(values);
    });
    for (const m of models) {
      m.stats = stats;
      m.folderStats = folderStats;
      m.metrics = metrics;
    }
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

/** Weight of each union file for the layout: its largest value of the ground-area metric over time. */
export function layoutWeights(
  data: TimelineData,
  areaMetric: string,
): Array<{ path: string; weight: number }> {
  const max = new Float64Array(data.paths.length).fill(1);
  for (const frame of data.frames) {
    frame.model.files.forEach((file, i) => {
      const v = file.values[areaMetric];
      const u = frame.unionIndex[i] as number;
      if (v !== undefined && v > (max[u] as number)) max[u] = v;
    });
  }
  return data.paths.map((path, i) => ({ path, weight: max[i] as number }));
}
