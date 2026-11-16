import type { IgnoreSummary } from "@factory-city/schema";
import { globToRegExp, matchesAny } from "./glob.js";
import type { LanguageConfig } from "./languages/index.js";
import { languageForPath } from "./languages/index.js";
import {
  DEPENDENCY_FOLDERS,
  LOCKFILES,
  MAX_NON_SOURCE_SHARE,
  MIN_FILES_FOR_SHARE_RULE,
  NON_ENGINEERING_FOLDERS,
} from "./select-tables.js";
import type { SourceEntry } from "./source/types.js";

export interface SelectOptions {
  all: boolean;
  include: string[];
  exclude: string[];
  /** Restrict to this subfolder (posix, relative). */
  subPath?: string;
}

export function emptySummary(): IgnoreSummary {
  return { files: {}, folders: {}, warnings: {} };
}

export function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export interface Candidate {
  entry: SourceEntry;
  language: LanguageConfig | undefined;
  isTest: boolean;
}

export function isTestPath(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  const file = parts.pop() ?? "";
  if (
    parts.some((p) =>
      ["test", "tests", "__tests__", "spec", "specs", "__mocks__", "e2e", "cypress"].includes(p),
    )
  )
    return true;
  if (/\.(test|spec)\.[a-z]+$/.test(file) || /(^|_)(tests?|spec)\.[a-z]+$/.test(file) || /^test_/.test(file))
    return true;
  // OrderServiceTest.java, InvoiceTests.cs, OrderSpec.kt: the suffix starts a new word
  return /[a-z0-9](Tests?|Spec)\.[a-z]+$/.test(path.split("/").pop() ?? "");
}

export function isGeneratedName(path: string): boolean {
  const file = (path.split("/").pop() ?? "").toLowerCase();
  return LOCKFILES.has(file) || /\.min\.[a-z]+$/.test(file) || file.endsWith(".map");
}

/** Reason a folder is left out by default, judged from its name alone. */
export function folderReason(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (DEPENDENCY_FOLDERS.has(lower)) return "dependency_or_build_folder";
  if (NON_ENGINEERING_FOLDERS.has(lower)) return "non_engineering_folder";
  return undefined;
}

export function makeFolderSkipper(options: SelectOptions) {
  const excludes = options.exclude.map(globToRegExp);
  const includes = options.include.map(globToRegExp);
  return (path: string, name: string): string | undefined => {
    const asDir = `${path}/`;
    if (includes.length && (matchesAny(path, includes) || matchesAny(asDir, includes))) return undefined;
    if (excludes.length && (matchesAny(path, excludes) || matchesAny(asDir, excludes)))
      return "excluded_by_pattern";
    if (options.all) return name === ".git" ? "dependency_or_build_folder" : undefined;
    return folderReason(name);
  };
}

/** Why a file is left out (counted in the summary), or nothing when it stays. A forced file always stays. */
function ignoredReason(
  path: string,
  forced: boolean,
  options: SelectOptions,
  excludes: RegExp[],
): string | undefined {
  if (forced) return undefined;
  if (excludes.length > 0 && matchesAny(path, excludes)) return "excluded_by_pattern";
  if (options.all) return undefined;
  const folder = path
    .split("/")
    .slice(0, -1)
    .map(folderReason)
    .find((r) => r !== undefined);
  if (folder) return folder;
  return isGeneratedName(path) ? "generated_or_vendored" : undefined;
}

/** Decides which entries are analyzed. File content checks (binary, generated marker) happen later. */
export function selectEntries(
  entries: SourceEntry[],
  options: SelectOptions,
  summary: IgnoreSummary,
): Candidate[] {
  const includes = options.include.map(globToRegExp);
  const excludes = options.exclude.map(globToRegExp);
  const sub = options.subPath ? `${options.subPath.replace(/\/+$/, "")}/` : "";
  const candidates: Candidate[] = [];

  for (const entry of entries) {
    if (sub && !entry.path.startsWith(sub)) continue;
    if (entry.kind !== "file") {
      bump(summary.warnings, entry.kind === "submodule" ? "submodule" : "symlink");
      continue;
    }
    const forced = includes.length > 0 && matchesAny(entry.path, includes);
    const reason = ignoredReason(entry.path, forced, options, excludes);
    if (reason) {
      bump(summary.files, reason);
      continue;
    }
    const language = languageForPath(entry.path);
    if (!language && !options.all && !forced) {
      bump(summary.files, "not_source_code");
      continue;
    }
    candidates.push({ entry, language, isTest: isTestPath(entry.path) });
  }
  return options.all ? candidates : dropMostlyNonSourceFolders(entries, candidates, sub, summary);
}

/** The folders above a file, from the top: `a/b/c.ts` gives `a` and `a/b`. */
function ancestors(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** For each folder, the number of files under it, among those counted. */
function countByFolder(paths: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) for (const a of ancestors(path)) counts.set(a, (counts.get(a) ?? 0) + 1);
  return counts;
}

/** A folder where almost no file is source code is treated as non-engineering. */
function dropMostlyNonSourceFolders(
  entries: SourceEntry[],
  candidates: Candidate[],
  sub: string,
  summary: IgnoreSummary,
): Candidate[] {
  const total = countByFolder(
    entries.filter((e) => e.kind === "file" && (!sub || e.path.startsWith(sub))).map((e) => e.path),
  );
  const source = countByFolder(candidates.filter((c) => c.language).map((c) => c.entry.path));
  const sparse = new Set<string>();
  for (const [dir, n] of total) {
    if (n >= MIN_FILES_FOR_SHARE_RULE && (source.get(dir) ?? 0) / n < MAX_NON_SOURCE_SHARE) sparse.add(dir);
  }
  if (sparse.size === 0) return candidates;
  return candidates.filter((c) => {
    const dropped = ancestors(c.entry.path).some((a) => sparse.has(a));
    if (dropped) bump(summary.files, "non_engineering_folder");
    return !dropped;
  });
}

export { DEPENDENCY_FOLDERS, NON_ENGINEERING_FOLDERS } from "./select-tables.js";
