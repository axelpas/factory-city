import type { AnalysisManifest, CcJson, FileNode } from "@factory-city/schema";
import { METRICS, type MetricDefinition } from "@factory-city/schema/registry";

export interface FileRec {
  id: string;
  path: string;
  name: string;
  /** Folder path, "" for the root. */
  dir: string;
  values: Record<string, number>;
  isTest: boolean;
}

export interface FolderRec {
  path: string;
  name: string;
  depth: number;
  files: number[];
  rloc: number;
  /** Folder-scope metrics, such as folder cohesion. */
  values: Record<string, number>;
}

export interface MetricStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p99: number;
  /** Ascending. */
  sorted: number[];
}

export interface Model {
  project: string;
  manifest?: AnalysisManifest;
  files: FileRec[];
  filesByPath: Map<string, number>;
  folders: Map<string, FolderRec>;
  metrics: Map<string, MetricDefinition>;
  stats: Map<string, MetricStats>;
  /** Statistics of folder-scope metrics. */
  folderStats: Map<string, MetricStats>;
  categories: Record<string, string[]>;
  /** Share of code (by real lines, else by files) that has a value, per metric. */
  coverage: Map<string, number>;
}

const REGISTRY = new Map(METRICS.map((m) => [m.id, m]));

function unknownMetric(id: string): MetricDefinition {
  return {
    id,
    label: id.replace(/_/g, " "),
    definition: "A metric provided by the snapshot.",
    computation: "Computed by the tool that produced the snapshot.",
    why: "Provided with the data.",
    unit: "",
    direction: "neutral",
    kind: "number",
    scope: "file",
    level: 0,
    limits: "Not described in the Factory City registry.",
    experimental: false,
    retrospective: false,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function statsOf(values: number[]): MetricStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p50: quantile(sorted, 0.5),
    p99: quantile(sorted, 0.99),
    sorted,
  };
}

/** Fraction of values that are at or below `value` (0..1). */
export function percentileRank(stats: MetricStats, value: number): number {
  const { sorted } = stats;
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

export function buildModel(cc: CcJson, manifest?: AnalysisManifest): Model {
  const attributes = cc.lenses.metrics.attributes;
  const files: FileRec[] = [];
  const folders = new Map<string, FolderRec>();

  const folderValues = (id: string): Record<string, number> => {
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(attributes[id] ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
    }
    return values;
  };

  const visit = (node: FileNode, parts: string[]): void => {
    if (node.type === "Folder") {
      const path = parts.join("/");
      folders.set(path, {
        path,
        name: node.name,
        depth: parts.length,
        files: [],
        rloc: 0,
        values: folderValues(node.id),
      });
      for (const child of node.children ?? []) visit(child, [...parts, child.name]);
      return;
    }
    const path = parts.join("/");
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(attributes[node.id] ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
    }
    files.push({
      id: node.id,
      path,
      name: node.name,
      dir: parts.slice(0, -1).join("/"),
      values,
      isTest: values.is_test === 1,
    });
  };
  for (const root of cc.files) {
    folders.set("", {
      path: "",
      name: root.name,
      depth: 0,
      files: [],
      rloc: 0,
      values: folderValues(root.id),
    });
    for (const child of root.children ?? []) visit(child, [child.name]);
  }

  const filesByPath = new Map(files.map((f, i) => [f.path, i]));
  const present = new Set<string>();
  for (const f of files) for (const k of Object.keys(f.values)) present.add(k);
  const metrics = new Map<string, MetricDefinition>();
  for (const id of [...present].sort()) metrics.set(id, REGISTRY.get(id) ?? unknownMetric(id));

  const folderMetricIds = new Set<string>();
  for (const folder of folders.values()) for (const k of Object.keys(folder.values)) folderMetricIds.add(k);
  for (const id of [...folderMetricIds].sort()) metrics.set(id, REGISTRY.get(id) ?? unknownMetric(id));

  const stats = new Map<string, MetricStats>();
  const folderStats = new Map<string, MetricStats>();
  const coverage = new Map<string, number>();
  const totalWeight = files.reduce((sum, f) => sum + (f.values.rloc ?? 1), 0) || 1;
  for (const id of metrics.keys()) {
    if (folderMetricIds.has(id)) continue;
    const values: number[] = [];
    let covered = 0;
    for (const f of files) {
      const v = f.values[id];
      if (v === undefined) continue;
      values.push(v);
      covered += f.values.rloc ?? 1;
    }
    stats.set(id, statsOf(values));
    coverage.set(id, covered / totalWeight);
  }

  files.forEach((f, index) => {
    // every ancestor folder counts the file
    const parts = f.dir ? f.dir.split("/") : [];
    for (let i = 0; i <= parts.length; i++) {
      const folder = folders.get(parts.slice(0, i).join("/"));
      if (folder) {
        folder.files.push(index);
        folder.rloc += f.values.rloc ?? 0;
      }
    }
  });

  for (const id of folderMetricIds) {
    const values: number[] = [];
    let covered = 0;
    let total = 0;
    for (const folder of folders.values()) {
      if (folder.depth === 0) continue;
      total += folder.rloc || 1;
      const v = folder.values[id];
      if (v === undefined) continue;
      values.push(v);
      covered += folder.rloc || 1;
    }
    folderStats.set(id, statsOf(values));
    coverage.set(id, total === 0 ? 0 : covered / total);
  }

  return {
    project: manifest?.project ?? cc.meta.projectName,
    manifest,
    files,
    filesByPath,
    folders,
    metrics,
    stats,
    folderStats,
    categories: manifest?.categories ?? {},
    coverage,
  };
}

export function categoryLabel(model: Model, metricId: string, value: number): string {
  return model.categories[metricId]?.[value] ?? `#${value}`;
}
