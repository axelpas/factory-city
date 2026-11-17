import { languageForPath } from "../languages/index.js";
import { dirOf } from "../resolve/paths.js";
import { buildImportGraph, folderCohesion, loadResolveContext } from "../resolve.js";
import { folderReason } from "../select.js";
import type { Source } from "../source/types.js";
import type { FileValues } from "./types.js";

/** Resolves imports across the analyzed files, then adds `imports_out`, `imports_in` and `folder_cohesion`. */
export async function addCoupling(
  source: Source,
  entryPaths: string[],
  attributesByPath: FileValues,
  importsByFile: Map<string, string[]>,
  folderAttributes: FileValues,
): Promise<Array<[string, string]>> {
  if (importsByFile.size === 0) return [];
  const entries = new Map(
    (await source.list({ skipDir: (_p, name) => folderReason(name) })).map((e) => [e.path, e]),
  );
  const reader = async (path: string): Promise<string | undefined> => {
    const entry = entries.get(path);
    if (entry?.kind !== "file" || entry.size > 1_000_000) return undefined;
    try {
      return (await source.read(entry)).toString("utf8");
    } catch {
      return undefined;
    }
  };
  const files = new Set(attributesByPath.keys());
  const ctx = await loadResolveContext(entryPaths, files, reader);
  const graph = buildImportGraph(importsByFile, ctx);
  addImportCounts(graph, attributesByPath);
  addFolderCohesion(graph, folderAttributes);
  const links: Array<[string, string]> = [];
  for (const [file, targets] of graph) for (const target of targets) links.push([file, target]);
  return links;
}

type Graph = ReturnType<typeof buildImportGraph>;

function addImportCounts(graph: Graph, attributesByPath: FileValues): void {
  const incoming = new Map<string, number>();
  for (const targets of graph.values()) for (const t of targets) incoming.set(t, (incoming.get(t) ?? 0) + 1);
  for (const [file, targets] of graph) {
    const values = attributesByPath.get(file);
    if (!values) continue;
    // a Go import is a package, which is a folder: it counts once, however many files it has
    values.imports_out =
      languageForPath(file)?.modules?.resolver === "go"
        ? new Set([...targets].map(dirOf)).size
        : targets.size;
    values.imports_in = incoming.get(file) ?? 0;
  }
}

function addFolderCohesion(graph: Graph, folderAttributes: FileValues): void {
  const folders = new Set<string>();
  for (const file of graph.keys()) {
    const parts = file.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  const graphFiles = [...graph.keys()];
  for (const folder of folders) {
    const inside = graphFiles.filter((f) => f.startsWith(`${folder}/`));
    const value = folderCohesion(folder, inside, graph);
    if (value !== undefined) folderAttributes.set(folder, { folder_cohesion: value });
  }
}
