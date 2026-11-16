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
    const top = plinthTop(label.depth);
    // the edge lowest on the screen is the one nearest to the viewer
    let front:
      | {
          a: { x: number; y: number };
          b: { x: number; y: number };
          at: (t: number) => { x: number; y: number };
        }
      | undefined;
    for (const [p, q] of edges(label.rect, top)) {
      const a = projector.project(...p);
      const b = projector.project(...q);
      if (!front || a.y + b.y > front.a.y + front.b.y)
        front = {
          a,
          b,
          at: (t) => projector.project(p[0] + (q[0] - p[0]) * t, top, p[2] + (q[2] - p[2]) * t),
        };
    }
    if (!front) continue;
    const size = measure(label);
    const edgePx = Math.hypot(front.a.x - front.b.x, front.a.y - front.b.y);
    if (label.depth > 1 && size.w + FIT_PAD > edgePx) continue;
    for (const t of ALONG) {
      const anchor = front.at(t);
      const box = { x: anchor.x - size.w / 2, y: anchor.y + 1, w: size.w, h: size.h };
      if (!inside(box, free)) continue;
      if (placed.some((p) => overlaps(p.box, box))) continue;
      if (avoid.some((a) => overlaps(a, box))) continue;
      const samples = [
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w / 2, box.y + box.h / 2],
        [box.x, box.y + box.h],
        [box.x + box.w, box.y + box.h],
        [anchor.x, anchor.y],
      ] as const;
      if (samples.some(([x, y]) => projector.blocked(x, y))) continue;
      placed.push({ ...label, box });
      break;
    }
  }
  return placed;
}
