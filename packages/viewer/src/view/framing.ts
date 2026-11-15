export type Vec3 = readonly [number, number, number];

/** Space taken by the bar, the panels and the timeline on each side of the stage, in pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** Share of the free area left empty on each side of the city. */
export const FRAME_MARGIN = 0.05;
/** The free area never gets smaller than this share of the stage: panels then overlap the city. */
const MIN_FREE_SHARE = 0.3;

/** The part of the stage that no panel covers. */
export function freeRect(viewport: { w: number; h: number }, insets: Insets): Rect {
  const clampSide = (start: number, end: number, size: number): [number, number] => {
    const s = Math.max(0, Math.min(start, size));
    const e = Math.max(0, Math.min(end, size));
    if (size - s - e >= size * MIN_FREE_SHARE) return [s, size - s - e];
    // too little room: keep the larger side's inset only, then none
    const one = s >= e ? [s, 0] : [0, e];
    if (size - (one[0] as number) - (one[1] as number) >= size * MIN_FREE_SHARE)
      return [one[0] as number, size - (one[0] as number) - (one[1] as number)];
    return [0, size];
  };
  const [x, w] = clampSide(insets.left, insets.right, viewport.w);
  const [y, h] = clampSide(insets.top, insets.bottom, viewport.h);
  return { x, y, w, h };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** The camera's right and up axes for a viewing direction (from the target to the camera), world up being +Y. */
export function cameraBasis(direction: Vec3): { dir: Vec3; right: Vec3; up: Vec3 } {
  const dir = normalize(direction);
  let right = cross([0, 1, 0], dir);
  // looking straight down: any horizontal axis will do, take +X
  right = Math.hypot(right[0], right[1], right[2]) < 1e-9 ? [1, 0, 0] : normalize(right);
  return { dir, right, up: cross(dir, right) };
}

/** The eight corners of the city's box, relative to the camera target at the center of the ground. */
export function cityCorners(size: number, height: number): Vec3[] {
  const half = size / 2;
  const corners: Vec3[] = [];
  for (const x of [-half, half])
    for (const y of [0, height]) for (const z of [-half, half]) corners.push([x, y, z]);
  return corners;
}

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function extent(points: Array<[number, number]>): Extent {
  const e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    e.minX = Math.min(e.minX, x);
    e.maxX = Math.max(e.maxX, x);
    e.minY = Math.min(e.minY, y);
    e.maxY = Math.max(e.maxY, y);
  }
  return e;
}

/** Where the target must land on the stage so that the projected box sits in the middle of the free area. */
function centerFor(e: Extent, free: Rect): { x: number; y: number } {
  return { x: free.x + free.w / 2 - (e.minX + e.maxX) / 2, y: free.y + free.h / 2 - (e.minY + e.maxY) / 2 };
}

export interface FrameInput {
  /** Points to keep in view, relative to the camera target. */
  corners: readonly Vec3[];
  /** From the target to the camera. */
  direction: Vec3;
  viewport: { w: number; h: number };
  free: Rect;
  margin?: number;
}

/** Pixel position of a point seen by a perspective camera at `distance`, relative to where the target lands. */
export function projectPerspective(
  point: Vec3,
  direction: Vec3,
  distance: number,
  fovDeg: number,
  viewportHeight: number,
): [number, number] {
  const { dir, right, up } = cameraBasis(direction);
  const focal = viewportHeight / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const depth = Math.max(distance - dot(point, dir), 1e-6);
  return [(dot(point, right) / depth) * focal, (-dot(point, up) / depth) * focal];
}

/**
 * The closest distance at which a perspective camera sees every corner inside the free area, and where the
 * target must land for the picture to be centered there.
 */
export function framePerspective(input: FrameInput & { fovDeg: number }): {
  distance: number;
  center: { x: number; y: number };
} {
  const margin = input.margin ?? FRAME_MARGIN;
  const maxW = input.free.w * (1 - 2 * margin);
  const maxH = input.free.h * (1 - 2 * margin);
  const { dir } = cameraBasis(input.direction);
  const at = (distance: number) =>
    extent(
      input.corners.map((c) =>
        projectPerspective(c, input.direction, distance, input.fovDeg, input.viewport.h),
      ),
    );
  const fits = (distance: number) => {
    const e = at(distance);
    return e.maxX - e.minX <= maxW && e.maxY - e.minY <= maxH;
  };
  // the camera stays in front of every corner
  let lo = Math.max(...input.corners.map((c) => dot(c, dir))) + 1e-3;
  let hi = Math.max(lo * 2, 1);
  while (!fits(hi)) hi *= 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { distance: hi, center: centerFor(at(hi), input.free) };
}

/**
 * The zoom at which an orthographic camera sees every corner inside the free area. `unitsHigh` is the height
 * of the camera's frame, in world units, at zoom 1.
 */
export function frameOrthographic(input: FrameInput & { unitsHigh: number }): {
  zoom: number;
  center: { x: number; y: number };
} {
  const margin = input.margin ?? FRAME_MARGIN;
  const { right, up } = cameraBasis(input.direction);
  const world = extent(input.corners.map((c) => [dot(c, right), -dot(c, up)]));
  const pixelsPerUnit = Math.min(
    (input.free.w * (1 - 2 * margin)) / Math.max(world.maxX - world.minX, 1e-9),
    (input.free.h * (1 - 2 * margin)) / Math.max(world.maxY - world.minY, 1e-9),
  );
  const scaled: Extent = {
    minX: world.minX * pixelsPerUnit,
    maxX: world.maxX * pixelsPerUnit,
    minY: world.minY * pixelsPerUnit,
    maxY: world.maxY * pixelsPerUnit,
  };
  return {
    zoom: (pixelsPerUnit * input.unitsHigh) / input.viewport.h,
    center: centerFor(scaled, input.free),
  };
}
