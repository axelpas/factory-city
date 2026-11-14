import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

/** One file to place: its posix path and the weight that drives its parcel area. */
export interface LayoutFile {
  path: string;
  weight: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  /** Size of the whole map. */
  width: number;
  height: number;
  /** One parcel per file, keyed by path. */
  files: Map<string, Rect>;
  /** One plinth per folder, keyed by path; the root folder is the empty string. */
  folders: Map<string, Rect>;
}

export interface LayoutOptions {
  /** Side of the square map. Default 1000. */
  size?: number;
  /** Gap between parcels and around folders, as a share of the map side. Default 0.0015. */
  padding?: number;
}

interface TreeNode {
  path: string;
  name: string;
  weight: number;
  children?: TreeNode[];
}

const MIN_WEIGHT = 1;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildTree(files: readonly LayoutFile[]): TreeNode {
  const root: TreeNode = { path: "", name: "", weight: 0, children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);
  const sorted = [...files].sort((a, b) => compare(a.path, b.path));
  for (const file of sorted) {
    const parts = file.path.split("/");
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = { path, name: parts[i] as string, weight: 0, children: [] };
        folders.set(path, folder);
        parent.children?.push(folder);
      }
      parent = folder;
    }
    parent.children?.push({
      path: file.path,
      name: parts[parts.length - 1] as string,
      weight: Math.max(Number.isFinite(file.weight) ? file.weight : 0, MIN_WEIGHT),
    });
  }
  return root;
}

/**
 * Deterministic treemap of folders and files: same input, same map, whatever the input order.
 * Pure function: no DOM, no Node API, no randomness.
 */
export function computeLayout(files: readonly LayoutFile[], options: LayoutOptions = {}): Layout {
  const size = options.size ?? 1000;
  const padding = size * (options.padding ?? 0.0015);
  const layout: Layout = { width: size, height: size, files: new Map(), folders: new Map() };
  if (files.length === 0) {
    layout.folders.set("", { x: 0, y: 0, w: size, h: size });
    return layout;
  }
  const root = hierarchy(buildTree(files))
    .sum((d) => (d.children ? 0 : d.weight))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || compare(a.data.path, b.data.path));
  const placed = treemap<TreeNode>()
    .size([size, size])
    .tile(treemapSquarify.ratio(1))
    .paddingInner(padding / 2)
    .paddingOuter(padding)
    .round(false)(root);
  for (const node of placed.descendants()) {
    const rect: Rect = { x: node.x0, y: node.y0, w: node.x1 - node.x0, h: node.y1 - node.y0 };
    (node.children ? layout.folders : layout.files).set(node.data.path, rect);
  }
  return layout;
}
