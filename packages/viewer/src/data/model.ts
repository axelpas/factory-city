import type { AnalysisManifest } from "@factory-city/schema";
import type { MetricDefinition } from "@factory-city/schema/registry";
import { languageLabel } from "../view/labels";
import type { MetricStats } from "./stats";

export { buildModel } from "./model-build";
export { type MetricStats, percentileRank, statsOf } from "./stats";

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

export function categoryLabel(model: Model, metricId: string, value: number): string {
  const label = model.categories[metricId]?.[value];
  if (label === undefined) return `#${value}`;
  // languages are stored by id: show their name
  return metricId === "language" ? languageLabel(label) : label;
}
