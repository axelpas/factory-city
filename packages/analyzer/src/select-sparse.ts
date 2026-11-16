import type { Candidate } from "./select.js";
import { MAX_NON_SOURCE_SHARE, MIN_FILES_FOR_SHARE_RULE } from "./select-tables.js";
import type { SourceEntry } from "./source/types.js";

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
export function dropMostlyNonSourceFolders(
  entries: SourceEntry[],
  candidates: Candidate[],
  sub: string,
): { kept: Candidate[]; dropped: number } {
  const total = countByFolder(
    entries.filter((e) => e.kind === "file" && (!sub || e.path.startsWith(sub))).map((e) => e.path),
  );
  const source = countByFolder(candidates.filter((c) => c.language).map((c) => c.entry.path));
  const sparse = new Set<string>();
  for (const [dir, n] of total) {
    if (n >= MIN_FILES_FOR_SHARE_RULE && (source.get(dir) ?? 0) / n < MAX_NON_SOURCE_SHARE) sparse.add(dir);
  }
  const kept =
    sparse.size === 0
      ? candidates
      : candidates.filter((c) => !ancestors(c.entry.path).some((a) => sparse.has(a)));
  return { kept, dropped: candidates.length - kept.length };
}

export { DEPENDENCY_FOLDERS, NON_ENGINEERING_FOLDERS } from "./select-tables.js";
