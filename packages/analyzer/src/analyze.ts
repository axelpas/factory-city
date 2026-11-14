import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import type { AttributeDescriptor, CcJson, FileNode } from "@factory-city/schema";
import { buildCcJson, getMetric, nodeId } from "@factory-city/schema";
import { inspectContent } from "./inspect.js";
import { LANGUAGES } from "./languages/index.js";
import { computeMetrics, plainMetrics } from "./metrics/file-metrics.js";
import { getParser } from "./parse.js";
import type { IgnoreSummary } from "./select.js";
import { bump, emptySummary, makeFolderSkipper, selectEntries } from "./select.js";
import { DiskSource } from "./source/disk.js";
import { findRepo, GitSource } from "./source/git.js";
import type { Source } from "./source/types.js";

export const ANALYZER_VERSION = "0.1.0";

export interface AnalyzeOptions {
  folder: string;
  /** Analyze a commit, tag or branch instead of HEAD. */
  rev?: string;
  /** Analyze the files on disk, including uncommitted changes. */
  dirty?: boolean;
  /** Restrict to a subfolder. */
  path?: string;
  all?: boolean;
  include?: string[];
  exclude?: string[];
}

export interface AnalysisManifest {
  kind: "snapshot";
  schemaVersion: 1;
  analyzerVersion: string;
  createdAt: string;
  project: string;
  source: { kind: "disk" | "git"; rev?: string; commit?: string; path?: string };
  /** Highest data level whose metrics are in this snapshot. */
  dataLevel: 0 | 1 | 2 | 3;
  git: { available: boolean; shallow: boolean };
  metrics: string[];
  /** Labels of category metrics: the snapshot stores the index. */
  categories: Record<string, string[]>;
  selected: number;
  analyzed: number;
  ignored: IgnoreSummary;
  warnings: string[];
  snapshot: string;
}

export interface AnalysisResult {
  snapshot: CcJson;
  manifest: AnalysisManifest;
}

const ABSOLUTE = new Set(["loc", "rloc", "comment_lines", "functions", "mcc"]);

async function openSource(
  opts: AnalyzeOptions,
  warnings: string[],
): Promise<{ source: Source; git: { available: boolean; shallow: boolean } }> {
  const folder = resolve(opts.folder);
  const repo = await findRepo(folder);
  const git = { available: repo !== undefined, shallow: repo?.shallow ?? false };
  if (opts.rev) {
    if (!repo)
      throw new Error(
        `--rev needs a git repository, but ${folder} is not inside one. Run without --rev to analyze the files on disk.`,
      );
    if (!repo.hasCommits)
      throw new Error("This repository has no commit yet. Commit something, or run without --rev.");
    return { source: await GitSource.open(folder, repo, opts.rev), git };
  }
  if (repo?.hasCommits && !opts.dirty) {
    return { source: await GitSource.open(folder, repo, "HEAD"), git };
  }
  if (repo && !repo.hasCommits && !opts.dirty)
    warnings.push("The repository has no commit yet: analyzing the files on disk.");
  return { source: new DiskSource(folder), git };
}

function buildTree(paths: string[], attributesByPath: Map<string, Record<string, number>>) {
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

export async function analyze(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const warnings: string[] = [];
  const summary = emptySummary();
  const { source, git } = await openSource(opts, warnings);
  try {
    if (git.shallow) {
      warnings.push(
        "Shallow clone: history is truncated. Run `git fetch --unshallow` to get the full history.",
      );
    }
    const selectOptions = {
      all: opts.all ?? false,
      include: opts.include ?? [],
      exclude: opts.exclude ?? [],
      subPath: opts.path,
    };
    const entries = await source.list({
      skipDir: makeFolderSkipper(selectOptions),
      onSkippedDir: (reason) => bump(summary.folders, reason),
    });
    const candidates = selectEntries(entries, selectOptions, summary);

    const languageIndex = new Map<string, number>();
    const attributesByPath = new Map<string, Record<string, number>>();
    const present = new Set<string>();
    let syntaxErrorFiles = 0;

    for (const { entry, language, isTest } of candidates) {
      const buffer = await source.read(entry);
      const inspected = inspectContent(buffer, !opts.all);
      if (inspected.problem || inspected.text === undefined) {
        const problem = inspected.problem ?? "non_utf8";
        if (problem === "generated_or_vendored") bump(summary.files, problem);
        else bump(summary.warnings, problem);
        continue;
      }
      const result = language
        ? computeMetrics(await getParser(language.grammar), language, inspected.text)
        : plainMetrics(inspected.text);
      if (result.syntaxErrors) syntaxErrorFiles++;
      const values: Record<string, number> = { ...result.metrics, is_test: isTest ? 1 : 0 };
      if (language) {
        if (!languageIndex.has(language.id)) languageIndex.set(language.id, languageIndex.size);
        values.language = languageIndex.get(language.id) as number;
      }
      for (const key of Object.keys(values)) present.add(key);
      attributesByPath.set(entry.path, values);
    }
    if (syntaxErrorFiles > 0)
      warnings.push(`${syntaxErrorFiles} file(s) have syntax errors; metrics are approximate for them.`);
    for (const [key, n] of Object.entries(summary.warnings))
      warnings.push(`${n} entr${n === 1 ? "y" : "ies"} skipped: ${key}.`);

    const project = basename(resolve(opts.folder));
    const { root, attributes } = buildTree([...attributesByPath.keys()], attributesByPath);
    const metricIds = [...present].sort();
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
    const snapshot = buildCcJson({
      projectName: project,
      commitHash: source.commit,
      files: [root],
      attributes,
      attributeDescriptors: descriptors,
      attributeTypes: types,
    });
    const known = new Set(LANGUAGES.map((l) => l.id));
    const manifest: AnalysisManifest = {
      kind: "snapshot",
      schemaVersion: 1,
      analyzerVersion: ANALYZER_VERSION,
      createdAt: new Date().toISOString(),
      project,
      source: { kind: source.kind, rev: opts.rev, commit: source.commit, path: opts.path },
      dataLevel: 0,
      git,
      metrics: metricIds,
      categories: {
        language: [...languageIndex.keys()].filter((id) => known.has(id)),
        is_test: ["no", "yes"],
      },
      selected: candidates.length,
      analyzed: attributesByPath.size,
      ignored: summary,
      warnings,
      snapshot: "snapshot.cc.json",
    };
    return { snapshot, manifest };
  } finally {
    await source.close();
  }
}

/** One human-readable line about what was analyzed and what was left out. */
export function summaryLine(manifest: AnalysisManifest): string {
  const labels: Record<string, string> = {
    not_source_code: "not source code",
    dependency_or_build_folder: "dependency or build folders",
    non_engineering_folder: "non-engineering folders (assets, docs...)",
    generated_or_vendored: "generated or vendored files",
    excluded_by_pattern: "excluded by pattern",
    gitignored: "ignored by .gitignore",
    "gitignored-file": "ignored by .gitignore",
  };
  const parts: string[] = [];
  const merged: Record<string, number> = {};
  for (const [reason, n] of Object.entries(manifest.ignored.files)) bump(merged, reason, n);
  for (const [reason, n] of Object.entries(manifest.ignored.folders)) bump(merged, reason, n);
  for (const [reason, n] of Object.entries(merged)) parts.push(`${n} ${labels[reason] ?? reason}`);
  const left = parts.length ? ` Left out: ${parts.join(", ")}. Use --all to include everything.` : "";
  return `Analyzed ${manifest.analyzed} file${manifest.analyzed === 1 ? "" : "s"}.${left}`;
}

export function slugFor(folder: string): string {
  const abs = resolve(folder);
  const name =
    basename(abs)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return `${name}-${createHash("sha1").update(abs).digest("hex").slice(0, 6)}`;
}
