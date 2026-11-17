import { basename, resolve } from "node:path";
import type {
  AnalysisManifest,
  AttributeDescriptor,
  CcJson,
  ExternalFindings,
  FileNode,
  Report,
} from "@factory-city/schema";
import { buildCcJson, getMetric, nodeId } from "@factory-city/schema";
import { type Config, DEFAULT_CONFIG, loadConfig } from "../config.js";
import { resolveDimensions } from "../health/dimensions.js";
import { computeHealth, findHiddenLinks, findHotspots, type HealthFile } from "../health/health.js";
import { LANGUAGES } from "../languages/index.js";
import type { emptySummary } from "../select.js";
import { ANALYZER_VERSION, SCORE_NOTICE } from "./constants.js";
import type { AnalysisResult, AnalyzeOptions, FileValues } from "./types.js";

/** Metrics that count things, as opposed to ratios. */
const ABSOLUTE = new Set([
  "loc",
  "rloc",
  "comment_lines",
  "functions",
  "mcc",
  "imports_out",
  "imports_in",
  "escape_hatches",
  "duplicated_lines",
  "number_of_commits",
  "recent_commits",
  "lines_added_recent",
  "lines_deleted_recent",
  "fix_commits",
  "fix_commits_recent",
  "sarif_findings",
  "sarif_error_findings",
  "rework_lines",
  "issues_recent",
]);

/** The folders and files as a tree of nodes, with the numbers of each by node id. */
function buildTree(paths: string[], attributesByPath: FileValues, folderAttributes: FileValues) {
  const attributes: Record<string, Record<string, number>> = {};
  const rootPath = "/root";
  const root: FileNode = { id: nodeId(rootPath), name: "root", type: "Folder", children: [] };
  const folders = new Map<string, FileNode>([["", root]]);

  const ensureFolder = (rel: string): FileNode => {
    const found = folders.get(rel);
    if (found) return found;
    const cut = rel.lastIndexOf("/");
    const parent = ensureFolder(rel.slice(0, Math.max(cut, 0)));
    const node: FileNode = {
      id: nodeId(`${rootPath}/${rel}`),
      name: rel.slice(cut + 1),
      type: "Folder",
      children: [],
    };
    parent.children?.push(node);
    folders.set(rel, node);
    const own = folderAttributes.get(rel);
    if (own) attributes[node.id] = own;
    return node;
  };

  for (const path of [...paths].sort()) {
    const cut = path.lastIndexOf("/");
    const parent = ensureFolder(cut < 0 ? "" : path.slice(0, cut));
    const node: FileNode = { id: nodeId(`${rootPath}/${path}`), name: path.slice(cut + 1), type: "File" };
    parent.children?.push(node);
    const values = attributesByPath.get(path);
    if (values) attributes[node.id] = values;
  }
  const sortChildren = (node: FileNode): void => {
    node.children?.sort((a, b) =>
      a.type === b.type ? (a.name < b.name ? -1 : 1) : a.type === "Folder" ? -1 : 1,
    );
    node.children?.forEach(sortChildren);
  };
  sortChildren(root);
  return { root, attributes };
}

/** What the output builders need to know about the analysis. */
export interface AnalysisFacts {
  opts: AnalyzeOptions;
  source: { kind: "disk" | "git"; commit?: string };
  git: { available: boolean; shallow: boolean };
  dataLevel: 0 | 1;
  authorLabels?: string[];
  selected: number;
  ignored: ReturnType<typeof emptySummary>;
  warnings: string[];
  attributesByPath: FileValues;
  folderAttributes: FileValues;
  /** Metric ids that at least one file or folder has. */
  present: Set<string>;
  groupNames: Map<string, string[][]>;
  importLinks: Array<[string, string]>;
  coChange: Array<[string, string]>;
  duplicates: Map<string, string>;
  blobs: Map<string, string>;
  /** Scanner results read from files, for the manifest. */
  external?: ExternalFindings[];
}

function buildSnapshot(facts: AnalysisFacts, project: string, metricIds: string[]): CcJson {
  const { root, attributes } = buildTree(
    [...facts.attributesByPath.keys()],
    facts.attributesByPath,
    facts.folderAttributes,
  );
  const descriptors: Record<string, AttributeDescriptor> = {};
  const types: Record<string, "absolute" | "relative"> = {};
  for (const id of metricIds) {
    const def = getMetric(id);
    descriptors[id] = {
      title: def?.label ?? id,
      description: def?.definition ?? "",
      analyzers: ["factory-city"],
    };
    types[id] = ABSOLUTE.has(id) ? "absolute" : "relative";
  }
  return buildCcJson({
    projectName: project,
    commitHash: facts.source.commit,
    files: [root],
    attributes,
    attributeDescriptors: descriptors,
    attributeTypes: types,
  });
}

function buildManifest(facts: AnalysisFacts, project: string, metricIds: string[]): AnalysisManifest {
  const { opts, source } = facts;
  return {
    kind: "snapshot",
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    createdAt: new Date().toISOString(),
    project,
    source: { kind: source.kind, rev: opts.rev, commit: source.commit, path: opts.path },
    dataLevel: facts.dataLevel,
    git: facts.git,
    metrics: metricIds,
    categories: {
      language: LANGUAGES.map((l) => l.id),
      is_test: ["no", "yes"],
      ...(facts.authorLabels ? { main_agent: facts.authorLabels } : {}),
    },
    selected: facts.selected,
    analyzed: facts.attributesByPath.size,
    ignored: facts.ignored,
    warnings: facts.warnings,
    ...(facts.external?.length ? { external: facts.external } : {}),
    snapshot: "snapshot.cc.json",
  };
}

async function buildReport(
  facts: AnalysisFacts,
  project: string,
  files: HealthFile[],
  createdAt: string,
): Promise<Report> {
  const { opts, source } = facts;
  const config: Config =
    opts.shared?.config ?? (await loadConfig(resolve(opts.folder)).catch(() => DEFAULT_CONFIG));
  // the scanner dimension exists only when the user brought a scanner file: no one is told it is missing
  const dimensions = resolveDimensions(config.thresholds).filter(
    (d) => d.id !== "scanner" || (opts.sarif?.length ?? 0) > 0,
  );
  const extras = {
    groups: facts.groupNames,
    imports: facts.importLinks,
    coChange: facts.coChange,
    duplicates: facts.duplicates,
  };
  return {
    kind: "report",
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    createdAt,
    project,
    ...(source.commit ? { commit: source.commit } : {}),
    dataLevel: facts.dataLevel,
    health: computeHealth(files, dimensions),
    dimensions,
    hotspots: findHotspots(files, dimensions, extras, 20),
    hiddenLinks: findHiddenLinks(extras),
    notice: SCORE_NOTICE,
  };
}

/** The snapshot, its manifest and the code-health report of an analysis. */
export async function buildOutputs(facts: AnalysisFacts): Promise<AnalysisResult> {
  for (const values of facts.attributesByPath.values())
    for (const key of Object.keys(values)) facts.present.add(key);
  for (const values of facts.folderAttributes.values())
    for (const key of Object.keys(values)) facts.present.add(key);
  const project = basename(resolve(facts.opts.folder));
  const metricIds = [...facts.present].sort();
  const snapshot = buildSnapshot(facts, project, metricIds);
  const manifest = buildManifest(facts, project, metricIds);
  const files: HealthFile[] = [...facts.attributesByPath].map(([path, values]) => ({
    path,
    values,
    isTest: values.is_test === 1,
  }));
  const report = await buildReport(facts, project, files, manifest.createdAt);
  return { snapshot, manifest, blobs: facts.blobs, report, files };
}
