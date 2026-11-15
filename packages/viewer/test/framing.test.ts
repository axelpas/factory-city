import { describe, expect, it } from "vitest";
import {
  cameraBasis,
  cityCorners,
  FRAME_MARGIN,
  frameOrthographic,
  framePerspective,
  freeRect,
  NO_INSETS,
  projectPerspective,
  type Rect,
  type Vec3,
} from "../src/view/framing";

const viewport = { w: 1500, h: 800 };
const corners = cityCorners(1000, 120);
const THREE_QUARTER: Vec3 = [0.75, 0.95, 1.1];
const TOP: Vec3 = [0, 1, 0.001];

const FREE: Array<[string, Rect]> = [
  ["the whole stage", freeRect(viewport, NO_INSETS)],
  ["bar and view panel", freeRect(viewport, { top: 60, left: 300, right: 0, bottom: 40 })],
  ["both panels and the timeline", freeRect(viewport, { top: 60, left: 300, right: 360, bottom: 140 })],
  ["a narrow strip", freeRect(viewport, { top: 60, left: 300, right: 700, bottom: 40 })],
];

function bounds(points: Array<[number, number]>, center: { x: number; y: number }) {
  const xs = points.map((p) => p[0] + center.x);
  const ys = points.map((p) => p[1] + center.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function expectFramed(b: ReturnType<typeof bounds>, free: Rect) {
  const mx = free.w * FRAME_MARGIN;
  const my = free.h * FRAME_MARGIN;
  // inside the free area, margins kept
  expect(b.minX).toBeGreaterThanOrEqual(free.x + mx - 0.5);
  expect(b.maxX).toBeLessThanOrEqual(free.x + free.w - mx + 0.5);
  expect(b.minY).toBeGreaterThanOrEqual(free.y + my - 0.5);
  expect(b.maxY).toBeLessThanOrEqual(free.y + free.h - my + 0.5);
  // centered
  expect((b.minX + b.maxX) / 2).toBeCloseTo(free.x + free.w / 2, 3);
  expect((b.minY + b.maxY) / 2).toBeCloseTo(free.y + free.h / 2, 3);
  // as large as the area allows: one dimension is filled
  const fillX = (b.maxX - b.minX) / (free.w - 2 * mx);
  const fillY = (b.maxY - b.minY) / (free.h - 2 * my);
  expect(Math.max(fillX, fillY)).toBeGreaterThan(0.999);
}

describe("free area of the stage", () => {
  it("is the stage minus what the bar, the panels and the timeline cover", () => {
    expect(freeRect(viewport, { top: 60, left: 300, right: 360, bottom: 140 })).toEqual({
      x: 300,
      y: 60,
      w: 840,
      h: 600,
    });
  });

  it("gives up an inset rather than leaving almost no room", () => {
    // 1500 - 800 - 600 leaves 100 px, under 30% of the stage: only the larger panel counts
    expect(freeRect(viewport, { top: 0, left: 800, right: 600, bottom: 0 })).toMatchObject({
      x: 800,
      w: 700,
    });
    // even one panel leaves too little: the city takes the whole width
    expect(freeRect(viewport, { top: 0, left: 1300, right: 0, bottom: 0 })).toMatchObject({ x: 0, w: 1500 });
  });
});

describe("framing with a perspective camera", () => {
  it.each(FREE)("fits and centers the city in %s", (_name, free) => {
    const fovDeg = 38;
    const { distance, center } = framePerspective({
      corners,
      direction: THREE_QUARTER,
      viewport,
      free,
      fovDeg,
    });
    const points = corners.map((c) => projectPerspective(c, THREE_QUARTER, distance, fovDeg, viewport.h));
    expectFramed(bounds(points, center), free);
  });

  it("moves the camera back when the free area shrinks", () => {
    const wide = framePerspective({
      corners,
      direction: THREE_QUARTER,
      viewport,
      free: FREE[0]?.[1] as Rect,
      fovDeg: 38,
    });
    const tight = framePerspective({
      corners,
      direction: THREE_QUARTER,
      viewport,
      free: FREE[2]?.[1] as Rect,
      fovDeg: 38,
    });
    expect(tight.distance).toBeGreaterThan(wide.distance);
  });
});

describe("framing with an orthographic camera", () => {
  const unitsHigh = 1280;
  const project = (direction: Vec3, zoom: number) => {
    const { right, up } = cameraBasis(direction);
    const scale = (zoom * viewport.h) / unitsHigh;
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return corners.map((c): [number, number] => [dot(c, right) * scale, -dot(c, up) * scale]);
  };

  it.each(FREE)("fits and centers the city in %s", (_name, free) => {
    const { zoom, center } = frameOrthographic({
      corners,
      direction: THREE_QUARTER,
      viewport,
      free,
      unitsHigh,
    });
    expectFramed(bounds(project(THREE_QUARTER, zoom), center), free);
  });

  it("shows a square city as a square from above, whatever its height", () => {
    const free = FREE[1]?.[1] as Rect;
    const { zoom, center } = frameOrthographic({ corners, direction: TOP, viewport, free, unitsHigh });
    const b = bounds(project(TOP, zoom), center);
    expect(b.maxX - b.minX).toBeCloseTo(b.maxY - b.minY, 0);
    expectFramed(b, free);
  });
});
