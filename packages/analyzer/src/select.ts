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
    if (!forced && excludes.length > 0 && matchesAny(entry.path, excludes)) {
      bump(summary.files, "excluded_by_pattern");
      continue;
    }
    if (!forced && !options.all) {
      const folders = entry.path.split("/").slice(0, -1);
      const hit = folders.map(folderReason).find((r) => r !== undefined);
      if (hit) {
        bump(summary.files, hit);
        continue;
      }
      if (isGeneratedName(entry.path)) {
        bump(summary.files, "generated_or_vendored");
        continue;
      }
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

/** A folder where almost no file is source code is treated as non-engineering. */
function dropMostlyNonSourceFolders(
  entries: SourceEntry[],
  candidates: Candidate[],
  sub: string,
  summary: IgnoreSummary,
): Candidate[] {
  const total = new Map<string, number>();
  const source = new Map<string, number>();
  const ancestors = (path: string): string[] => {
    const parts = path.split("/").slice(0, -1);
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  };
  const bumpMap = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const e of entries) {
    if (e.kind !== "file" || (sub && !e.path.startsWith(sub))) continue;
    for (const a of ancestors(e.path)) bumpMap(total, a);
  }
  for (const c of candidates) if (c.language) for (const a of ancestors(c.entry.path)) bumpMap(source, a);

  const sparse = new Set<string>();
  for (const [dir, n] of total) {
    if (n >= MIN_FILES_FOR_SHARE_RULE && (source.get(dir) ?? 0) / n < MAX_NON_SOURCE_SHARE) sparse.add(dir);
  }
  if (sparse.size === 0) return candidates;
  return candidates.filter((c) => {
    if (ancestors(c.entry.path).some((a) => sparse.has(a))) {
      bump(summary.files, "non_engineering_folder");
      return false;
    }
    return true;
  });
}

export { DEPENDENCY_FOLDERS, NON_ENGINEERING_FOLDERS } from "./select-tables.js";
