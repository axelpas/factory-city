import type { CcJson, FileNode } from "@factory-city/schema";

/** Ids only need to be unique here: the path itself does. The browser build must not import hashing code. */
function nodeId(path: string): string {
  return path;
}

/** Deterministic pseudo-random numbers, so that a synthetic city is the same on every run. */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A made-up timeline for performance checks (`?synthetic=5000&frames=6`): no real project is involved.
 * Files grow, shrink, appear and disappear from frame to frame.
 */
export function syntheticSnapshots(fileCount: number, frameCount: number): CcJson[] {
  const rand = generator(42);
  const paths: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const a = Math.floor(rand() * 12);
    const b = Math.floor(rand() * 8);
    paths.push(`pkg${a}/mod${b}/file${i}.ts`);
  }
  const base = paths.map(() => ({
    rloc: 10 + Math.floor(rand() ** 3 * 900),
    mcc: 1 + Math.floor(rand() ** 2 * 80),
    nest: Math.floor(rand() * 6),
  }));
  const out: CcJson[] = [];
  for (let f = 0; f < Math.max(frameCount, 1); f++) {
    const root: FileNode = { id: nodeId("/root"), name: "root", type: "Folder", children: [] };
    const folders = new Map<string, FileNode>([["", root]]);
    const attributes: Record<string, Record<string, number>> = {};
    const ensure = (path: string): FileNode => {
      const found = folders.get(path);
      if (found) return found;
      const cut = path.lastIndexOf("/");
      const node: FileNode = {
        id: nodeId(`/root/${path}`),
        name: path.slice(cut + 1),
        type: "Folder",
        children: [],
      };
      ensure(path.slice(0, Math.max(cut, 0))).children?.push(node);
      folders.set(path, node);
      return node;
    };
    paths.forEach((path, i) => {
      const present = frameCount === 1 || rand() > 0.12;
      const b = base[i];
      if (!present || !b) return;
      const k = 0.5 + rand();
      const cut = path.lastIndexOf("/");
      const node: FileNode = { id: nodeId(`/root/${path}`), name: path.slice(cut + 1), type: "File" };
      ensure(path.slice(0, cut)).children?.push(node);
      attributes[node.id] = {
        loc: Math.round(b.rloc * k * 1.2),
        rloc: Math.round(b.rloc * k),
        mcc: Math.max(1, Math.round(b.mcc * k)),
        max_nesting_level: Math.min(8, Math.round(b.nest * k)),
        functions: Math.max(1, Math.round((b.mcc * k) / 3)),
        language: 0,
        is_test: 0,
      };
    });
    out.push({
      meta: { projectName: `synthetic-${fileCount}`, apiVersion: "2.0", checksum: "synthetic" },
      files: [root],
      lenses: { metrics: { attributes, attributeDescriptors: {}, attributeTypes: {} } },
    });
  }
  return out;
}
