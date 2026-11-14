import type { FileNode } from "@factory-city/schema";
import { type AnalysisManifest, buildCcJson, nodeId } from "@factory-city/schema";
import { buildModel, type Model } from "../src/data/model";

export interface FileSpec {
  path: string;
  values: Record<string, number>;
}

export function makeModel(specs: FileSpec[], manifest?: Partial<AnalysisManifest>): Model {
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
  for (const spec of specs) {
    const cut = spec.path.lastIndexOf("/");
    const parent = ensure(cut < 0 ? "" : spec.path.slice(0, cut));
    const node: FileNode = { id: nodeId(`/root/${spec.path}`), name: spec.path.slice(cut + 1), type: "File" };
    parent.children?.push(node);
    attributes[node.id] = spec.values;
  }
  const cc = buildCcJson({ projectName: "demo", files: [root], attributes });
  const full: AnalysisManifest | undefined = manifest
    ? ({
        kind: "snapshot",
        schemaVersion: 1,
        analyzerVersion: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        project: "demo",
        source: { kind: "disk" },
        dataLevel: 0,
        git: { available: false, shallow: false },
        metrics: [],
        categories: {},
        selected: specs.length,
        analyzed: specs.length,
        ignored: { files: {}, folders: {}, warnings: {} },
        warnings: [],
        snapshot: "snapshot.cc.json",
        ...manifest,
      } as AnalysisManifest)
    : undefined;
  return buildModel(cc, full);
}

export const SAMPLE: FileSpec[] = [
  {
    path: "src/a.ts",
    values: {
      loc: 120,
      rloc: 100,
      mcc: 30,
      functions: 5,
      max_nesting_level: 4,
      language: 0,
      is_test: 0,
      max_function_complexity: 9,
    },
  },
  {
    path: "src/b.ts",
    values: {
      loc: 60,
      rloc: 50,
      mcc: 10,
      functions: 2,
      max_nesting_level: 2,
      language: 0,
      is_test: 0,
      max_function_complexity: 5,
    },
  },
  {
    path: "src/deep/c.tsx",
    values: {
      loc: 30,
      rloc: 25,
      mcc: 3,
      functions: 1,
      max_nesting_level: 1,
      language: 1,
      is_test: 0,
      max_function_complexity: 3,
    },
  },
  {
    path: "src/const.ts",
    values: { loc: 10, rloc: 8, mcc: 1, functions: 0, max_nesting_level: 0, language: 0, is_test: 0 },
  },
  {
    path: "test/a.test.ts",
    values: {
      loc: 40,
      rloc: 30,
      mcc: 4,
      functions: 2,
      max_nesting_level: 1,
      language: 0,
      is_test: 1,
      max_function_complexity: 2,
    },
  },
];
