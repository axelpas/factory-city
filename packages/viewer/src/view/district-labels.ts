import type { Layout, Rect } from "@factory-city/layout";
import { folderDepth, plinthTop } from "./placements";

/** A district that can carry its name on the ground. */
export interface DistrictLabel {
  path: string;
  name: string;
  depth: number;
  rect: Rect;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedLabel extends DistrictLabel {
  /** Screen position of the label's box. */
  box: Box;
}

/** What the placement needs from the scene: where a world point lands, and whether a building covers a pixel. */
export interface Projector {
  project(x: number, y: number, z: number): { x: number; y: number };
  /** True when a building, as drawn now, is under this pixel. */
  blocked(x: number, y: number): boolean;
}

/** More names than this would make a city unreadable whatever the camera. */
export const MAX_LABELS = 80;
/** Room kept between two labels, and between a label and what is behind it, in pixels. */
const GAP = 3;
/** Where along the front edge a label is tried, the middle first. */
const ALONG = [0.5, 0.25, 0.75];
/** A deeper district needs this much room (in pixels) around its name to be named. */
const FIT_PAD = 8;

/** The districts of a layout that can be named: every folder but the root, shallow first, big first. */
export function districtLabels(layout: Layout): DistrictLabel[] {
  const out: DistrictLabel[] = [];
  for (const [path, rect] of layout.folders) {
    if (path === "") continue;
    out.push({ path, name: path.slice(path.lastIndexOf("/") + 1), depth: folderDepth(path), rect });
  }
  return out.sort((a, b) => a.depth - b.depth || b.rect.w * b.rect.h - a.rect.w * a.rect.h);
}

export function overlaps(a: Box, b: Box, gap = GAP): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** True when the box lies inside the free part of the stage. */
export function inside(box: Box, free: Box): boolean {
  return (
    box.x >= free.x && box.y >= free.y && box.x + box.w <= free.x + free.w && box.y + box.h <= free.y + free.h
  );
}

/** The four edges of a plinth at ground height, as pairs of world points. */
function edges(rect: Rect, y: number): Array<[[number, number, number], [number, number, number]]> {
  const { x, y: z, w, h } = rect;
  return [
    [
      [x, y, z],
      [x + w, y, z],
    ],
    [
      [x, y, z + h],
      [x + w, y, z + h],
    ],
    [
      [x, y, z],
      [x, y, z + h],
    ],
    [
      [x + w, y, z],
      [x + w, y, z + h],
    ],
  ];
}

type Pt = { x: number; y: number };
interface Edge {
  a: Pt;
  b: Pt;
  /** The point at a share of the way along the edge, on the plinth top. */
  at: (t: number) => Pt;
}

/** The edge of a plinth lowest on the screen: the one nearest to the viewer. */
function frontEdge(label: DistrictLabel, projector: Projector): Edge | undefined {
  const top = plinthTop(label.depth);
  let front: Edge | undefined;
  for (const [p, q] of edges(label.rect, top)) {
    const a = projector.project(...p);
    const b = projector.project(...q);
    if (front && a.y + b.y <= front.a.y + front.b.y) continue;
    front = { a, b, at: (t) => projector.project(p[0] + (q[0] - p[0]) * t, top, p[2] + (q[2] - p[2]) * t) };
  }
  return front;
}

/** Whether a box can hold a name: inside the free area, over no other name and no avoided box. */
function isClear(box: Box, free: Box, placed: readonly PlacedLabel[], avoid: readonly Box[]): boolean {
  return (
    inside(box, free) && !placed.some((p) => overlaps(p.box, box)) && !avoid.some((a) => overlaps(a, box))
  );
}

/** Whether a building stands over one of the corners, the middle or the anchor of the box. */
function coversBuilding(box: Box, anchor: Pt, projector: Projector): boolean {
  const samples = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w / 2, box.y + box.h / 2],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
    [anchor.x, anchor.y],
  ] as const;
  return samples.some(([x, y]) => projector.blocked(x, y));
}

/** The first place along the edge where the name fits clear of everything. */
function placeAlong(
  front: Edge,
  size: { w: number; h: number },
  context: { projector: Projector; free: Box; placed: readonly PlacedLabel[]; avoid: readonly Box[] },
): Box | undefined {
  for (const t of ALONG) {
    const anchor = front.at(t);
    const box = { x: anchor.x - size.w / 2, y: anchor.y + 1, w: size.w, h: size.h };
    if (
      isClear(box, context.free, context.placed, context.avoid) &&
      !coversBuilding(box, anchor, context.projector)
    )
      return box;
  }
  return undefined;
}

/**
 * Names the districts on the ground. Each name hangs from the edge of its plinth nearest to the viewer, on
 * the street side, so it lies where no building stands: a name whose box would cover a building, another
 * name, or the part of the stage that panels hide is not shown. A top-level district is always tried; a
 * deeper one is named only when its edge is wide enough for the name, so deeper names appear as the camera
 * comes closer.
 */
export function placeLabels(
  labels: readonly DistrictLabel[],
  projector: Projector,
  measure: (label: DistrictLabel) => { w: number; h: number },
  free: Box,
  avoid: readonly Box[] = [],
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const label of labels) {
    if (placed.length >= MAX_LABELS) break;
    const front = frontEdge(label, projector);
    if (!front) continue;
    const size = measure(label);
    const edgePx = Math.hypot(front.a.x - front.b.x, front.a.y - front.b.y);
    if (label.depth > 1 && size.w + FIT_PAD > edgePx) continue;
    const box = placeAlong(front, size, { projector, free, placed, avoid });
    if (box) placed.push({ ...label, box });
  }
  return placed;
}
