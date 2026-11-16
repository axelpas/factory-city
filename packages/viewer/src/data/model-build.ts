import type { AnalysisManifest, CcJson, FileNode } from "@factory-city/schema";
import { METRICS, type MetricDefinition } from "@factory-city/schema/registry";
import type { FileRec, FolderRec, Model } from "./model";
import { type MetricStats, statsOf } from "./stats";

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

type Attributes = CcJson["lenses"]["metrics"]["attributes"];

/** The numbers of a node, leaving out what is not a finite number. */
function numbersOf(attributes: Attributes, id: string): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(attributes[id] ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
  }
  return values;
}

/** The files and the folders of the snapshot tree, with their numbers. */
function readTree(cc: CcJson) {
  const attributes = cc.lenses.metrics.attributes;
  const files: FileRec[] = [];
  const folders = new Map<string, FolderRec>();
  const addFolder = (path: string, node: FileNode, depth: number) =>
    folders.set(path, {
      path,
      name: node.name,
      depth,
      files: [],
      rloc: 0,
      values: numbersOf(attributes, node.id),
    });
  const visit = (node: FileNode, parts: string[]): void => {
    const path = parts.join("/");
    if (node.type === "Folder") {
      addFolder(path, node, parts.length);
      for (const child of node.children ?? []) visit(child, [...parts, child.name]);
      return;
    }
    const values = numbersOf(attributes, node.id);
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
    addFolder("", root, 0);
    for (const child of root.children ?? []) visit(child, [child.name]);
  }
  return { files, folders };
}

/** The definition of every metric the snapshot has a value for, files first, then folders. */
function metricDefinitions(files: FileRec[], folders: Map<string, FolderRec>) {
  const present = new Set(files.flatMap((f) => Object.keys(f.values)));
  const folderMetricIds = new Set([...folders.values()].flatMap((f) => Object.keys(f.values)));
  const metrics = new Map<string, MetricDefinition>();
  for (const id of [...present].sort()) metrics.set(id, REGISTRY.get(id) ?? unknownMetric(id));
  for (const id of [...folderMetricIds].sort()) metrics.set(id, REGISTRY.get(id) ?? unknownMetric(id));
  return { metrics, folderMetricIds };
}

/** Statistics of each file metric, and the share of the code (by real lines) that has a value. */
function fileStats(files: FileRec[], ids: Iterable<string>) {
  const stats = new Map<string, MetricStats>();
  const coverage = new Map<string, number>();
  const totalWeight = files.reduce((sum, f) => sum + (f.values.rloc ?? 1), 0) || 1;
  for (const id of ids) {
    const have = files.filter((f) => f.values[id] !== undefined);
    stats.set(id, statsOf(have.map((f) => f.values[id] as number)));
    coverage.set(id, have.reduce((sum, f) => sum + (f.values.rloc ?? 1), 0) / totalWeight);
  }
  return { stats, coverage };
}

/** Every ancestor folder counts the file and its real lines. */
function assignFiles(files: FileRec[], folders: Map<string, FolderRec>): void {
  files.forEach((f, index) => {
    const parts = f.dir ? f.dir.split("/") : [];
    for (let i = 0; i <= parts.length; i++) {
      const folder = folders.get(parts.slice(0, i).join("/"));
      if (!folder) continue;
      folder.files.push(index);
      folder.rloc += f.values.rloc ?? 0;
    }
  });
}

/** Statistics of each folder metric, weighted by the real lines of the folders (the root is left out). */
function folderStatistics(folders: Map<string, FolderRec>, ids: Iterable<string>) {
  const folderStats = new Map<string, MetricStats>();
  const coverage = new Map<string, number>();
  const inner = [...folders.values()].filter((f) => f.depth > 0);
  const total = inner.reduce((sum, f) => sum + (f.rloc || 1), 0);
  for (const id of ids) {
    const have = inner.filter((f) => f.values[id] !== undefined);
    folderStats.set(id, statsOf(have.map((f) => f.values[id] as number)));
    coverage.set(id, total === 0 ? 0 : have.reduce((sum, f) => sum + (f.rloc || 1), 0) / total);
  }
  return { folderStats, coverage };
}

export function buildModel(cc: CcJson, manifest?: AnalysisManifest): Model {
  const { files, folders } = readTree(cc);
  const { metrics, folderMetricIds } = metricDefinitions(files, folders);
  const own = fileStats(
    files,
    [...metrics.keys()].filter((id) => !folderMetricIds.has(id)),
  );
  assignFiles(files, folders);
  const folderPart = folderStatistics(folders, folderMetricIds);
  return {
    project: manifest?.project ?? cc.meta.projectName,
    manifest,
    files,
    filesByPath: new Map(files.map((f, i) => [f.path, i])),
    folders,
    metrics,
    stats: own.stats,
    folderStats: folderPart.folderStats,
    categories: manifest?.categories ?? {},
    coverage: new Map([...own.coverage, ...folderPart.coverage]),
  };
}
