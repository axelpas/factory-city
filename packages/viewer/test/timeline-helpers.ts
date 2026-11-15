import { computeLayout } from "@factory-city/layout";
import { buildCcJson, type CcJson, type FileNode, nodeId } from "@factory-city/schema";
import { buildTimelineData, layoutWeights, type TimelineData } from "../src/data/timeline";
import type { Mapping } from "../src/presets/index";
import { DEFAULT_THEME } from "../src/themes/index";
import { parseHex } from "../src/view/color";
import { computePlacements } from "../src/view/placements";
import { buildDelays, buildState } from "../src/view/state";

export type FrameSpec = Record<string, Record<string, number>>;

export function snapshot(files: FrameSpec): CcJson {
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
  for (const [path, values] of Object.entries(files)) {
    const cut = path.lastIndexOf("/");
    const node: FileNode = { id: nodeId(`/root/${path}`), name: path.slice(cut + 1), type: "File" };
    ensure(cut < 0 ? "" : path.slice(0, cut)).children?.push(node);
    attributes[node.id] = values;
  }
  return buildCcJson({ projectName: "demo", files: [root], attributes });
}

const v = (rloc: number, mcc: number, nest: number, extra: Record<string, number> = {}) => ({
  rloc,
  mcc,
  max_nesting_level: nest,
  language: 0,
  ...extra,
});

/** Five frames: files grow and shrink, one appears, one disappears and comes back, one is renamed away. */
export const FRAMES: FrameSpec[] = [
  { "src/a.ts": v(100, 10, 1), "src/b.ts": v(50, 5, 2), "lib/x.ts": v(30, 3, 0) },
  { "src/a.ts": v(180, 30, 4), "src/b.ts": v(50, 5, 2), "lib/x.ts": v(30, 3, 0), "src/new.ts": v(40, 8, 3) },
  { "src/a.ts": v(60, 6, 1), "lib/x.ts": v(90, 20, 5), "src/new.ts": v(45, 9, 3) },
  {
    "src/a.ts": v(60, 6, 1),
    "src/b.ts": v(20, 2, 0),
    "lib/x.ts": v(90, 20, 5),
    "src/new.ts": v(45, 9, 3),
    "lib/deep/y.ts": v(10, 1, 0),
  },
  { "src/a.ts": v(200, 40, 5), "src/b.ts": v(20, 2, 0), "lib/deep/y.ts": v(70, 12, 2) },
];

export const MAPPING: Mapping = {
  area: "rloc",
  height: "mcc",
  color: "max_nesting_level",
  marker: null,
  tint: null,
  scale: "sqrt",
  clampP99: true,
};

export function setup(frames: FrameSpec[] = FRAMES, mapping: Mapping = MAPPING) {
  const data: TimelineData = buildTimelineData(frames.map(snapshot));
  const layout = computeLayout(layoutWeights(data, mapping.area));
  const dimColor = parseHex(DEFAULT_THEME.colors.dim as string);
  const stateOf = (f: number, m: Mapping = mapping): Float32Array => {
    const frame = data.frames[f];
    if (!frame) throw new Error(`no frame ${f}`);
    const { placements } = computePlacements(frame.model, layout, m, DEFAULT_THEME);
    const aligned = data.paths.map((_, u) =>
      (frame.modelIndex[u] as number) >= 0 ? placements[frame.modelIndex[u] as number] : undefined,
    );
    return buildState(data.paths, layout, aligned, { dimColor });
  };
  const delays = buildDelays(data.paths, layout);
  const ramp = DEFAULT_THEME.ramps.sequential.map(parseHex);
  return { data, layout, stateOf, delays, ramp };
}
