import { resolveImport } from "./import.js";
import type { ResolveContext } from "./types.js";

/** Links between files of the project: file to the set of files it imports. */
export function buildImportGraph(
  imports: ReadonlyMap<string, string[]>,
  ctx: ResolveContext,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [file, specs] of imports) {
    const targets = new Set<string>();
    for (const spec of specs) {
      const target = resolveImport(spec, file, ctx);
      if (target && target !== file) targets.add(target);
    }
    graph.set(file, targets);
  }
  return graph;
}

export interface FolderCohesion {
  value: number;
}

/** Folder cohesion: internal links over internal plus outgoing links. Unavailable under 5 links. */
export function folderCohesion(
  _folder: string,
  files: readonly string[],
  graph: ReadonlyMap<string, Set<string>>,
): number | undefined {
  const inside = new Set(files);
  let internal = 0;
  let leaving = 0;
  for (const file of files) {
    for (const target of graph.get(file) ?? []) {
      if (inside.has(target)) internal++;
      else leaving++;
    }
  }
  const total = internal + leaving;
  return total < 5 ? undefined : internal / total;
}
