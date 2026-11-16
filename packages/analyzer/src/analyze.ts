import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import type { AnalysisManifest } from "@factory-city/schema";
import { addCoupling } from "./analysis/coupling.js";
import { addDuplication, measureFiles } from "./analysis/files.js";
import { addHistory } from "./analysis/history.js";
import { buildOutputs } from "./analysis/output.js";
import type { AnalysisResult, AnalyzeOptions } from "./analysis/types.js";
import { bump, emptySummary, makeFolderSkipper, selectEntries } from "./select.js";
import { DiskSource } from "./source/disk.js";
import type { RepoInfo } from "./source/git.js";
import { findRepo, GitSource } from "./source/git.js";
import type { Source } from "./source/types.js";

export { ANALYZER_VERSION, SCORE_NOTICE } from "./analysis/constants.js";
export type { AnalysisResult, AnalyzeOptions, AnalyzeShared, CachedFile } from "./analysis/types.js";

async function openSource(
  opts: AnalyzeOptions,
  warnings: string[],
): Promise<{ source: Source; git: { available: boolean; shallow: boolean }; repo: RepoInfo | undefined }> {
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
    return { source: await GitSource.open(folder, repo, opts.rev), git, repo };
  }
  if (repo?.hasCommits && !opts.dirty) {
    return { source: await GitSource.open(folder, repo, "HEAD"), git, repo };
  }
  if (repo && !repo.hasCommits && !opts.dirty)
    warnings.push("The repository has no commit yet: analyzing the files on disk.");
  return { source: new DiskSource(folder), git, repo };
}

/** Analyzes a folder or a revision: files, coupling, history, then the snapshot, its manifest and the report. */
export async function analyze(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const warnings: string[] = [];
  const summary = emptySummary();
  const { source, git, repo } = await openSource(opts, warnings);
  try {
    if (git.shallow)
      warnings.push(
        "Shallow clone: history is truncated. Run `git fetch --unshallow` to get the full history.",
      );
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

    const measured = await measureFiles(source, candidates, opts, summary);
    if (measured.syntaxErrorFiles > 0)
      warnings.push(
        `${measured.syntaxErrorFiles} file(s) have syntax errors; metrics are approximate for them.`,
      );
    for (const [key, n] of Object.entries(summary.warnings))
      warnings.push(`${n} entr${n === 1 ? "y" : "ies"} skipped: ${key}.`);

    const duplicates = opts.duplication
      ? await addDuplication(source, measured.analyzedEntries, measured.attributesByPath, opts)
      : new Map<string, string>();
    const folderAttributes = new Map<string, Record<string, number>>();
    const importLinks = await addCoupling(
      source,
      entries.map((e) => e.path),
      measured.attributesByPath,
      measured.importsByFile,
      folderAttributes,
    );
    const history = await addHistory(opts, repo, measured.attributesByPath, warnings);

    return await buildOutputs({
      opts,
      source,
      git,
      dataLevel: history.dataLevel,
      ...(history.authorLabels ? { authorLabels: history.authorLabels } : {}),
      selected: candidates.length,
      ignored: summary,
      warnings,
      attributesByPath: measured.attributesByPath,
      folderAttributes,
      present: measured.present,
      groupNames: measured.groupNames,
      importLinks,
      coChange: history.coChange,
      duplicates,
      blobs: measured.blobs,
    });
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
