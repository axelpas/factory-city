import { describe, expect, it } from "vitest";
import { D, H, PRESENCE, STRIDE, W, X, Y, Z } from "../src/anim/transition";
import { districtView, easeInOut, fadeStep, moveProgress, selectionBox } from "../src/view/scene-logic";

describe("camera move curve", () => {
  it("starts and ends flat, goes through the middle, and never leaves 0 to 1", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(7)).toBe(1);
    let previous = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      expect(easeInOut(t)).toBeGreaterThanOrEqual(previous);
      previous = easeInOut(t);
    }
  });

  it("measures the share of a timed move, and a zero duration is a cut", () => {
    expect(moveProgress(0, 600)).toBe(0);
    expect(moveProgress(300, 600)).toBe(0.5);
    expect(moveProgress(900, 600)).toBe(1);
    expect(moveProgress(10, 0)).toBe(1);
  });
});

describe("hover fade", () => {
  it("moves toward its target at one full fade per duration, and rests on it", () => {
    expect(fadeStep(0, 1, 70, 140)).toEqual({ value: 0.5, changed: true });
    expect(fadeStep(0.5, 1, 70, 140)).toEqual({ value: 1, changed: true });
    expect(fadeStep(1, 1, 16, 140)).toEqual({ value: 1, changed: false });
    expect(fadeStep(1, 0, 70, 140)).toEqual({ value: 0.5, changed: true });
  });

  it("never overshoots, even after a long frame", () => {
    expect(fadeStep(0.9, 1, 5000, 140).value).toBe(1);
    expect(fadeStep(0.1, 0, 5000, 140).value).toBe(0);
  });

  it("snaps to the target when it is almost there, once", () => {
    expect(fadeStep(0.9995, 1, 16, 140)).toEqual({ value: 1, changed: true });
    expect(fadeStep(1, 1, 16, 140).changed).toBe(false);
  });

  it("does not move backwards when time does", () => {
    expect(fadeStep(0.2, 1, -50, 140).value).toBe(0.2);
  });
});

describe("outline of the selected building", () => {
  const state = (
    ...buildings: Array<{
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
      d: number;
      presence: number;
    }>
  ) => {
    const out = new Float32Array(buildings.length * STRIDE);
    buildings.forEach((b, i) => {
      const o = i * STRIDE;
      out[o + X] = b.x;
      out[o + Y] = b.y;
      out[o + Z] = b.z;
      out[o + W] = b.w;
      out[o + H] = b.h;
      out[o + D] = b.d;
      out[o + PRESENCE] = b.presence;
    });
    return out;
  };
  const here = { x: 10, y: 2, z: 20, w: 4, h: 6, d: 8, presence: 1 };

  it("sits on the building, a little larger than it, standing on its base", () => {
    const box = selectionBox(state(here), 0);
    expect(box).toMatchObject({ x: 10, y: 5, z: 20 });
    expect(box?.w).toBeCloseTo(4.04, 10);
    expect(box?.h).toBeCloseTo(6.06, 10);
    expect(box?.d).toBeCloseTo(8.08, 10);
  });

  it("follows the animated state: another picture, another box", () => {
    expect(selectionBox(state({ ...here, h: 10 }), 0)?.y).toBe(7);
  });

  it("has no outline without a selection, without a state, or for a building that is not there", () => {
    expect(selectionBox(state(here), null)).toBeUndefined();
    expect(selectionBox(undefined, 0)).toBeUndefined();
    expect(selectionBox(state({ ...here, presence: 0.2 }), 0)).toBeUndefined();
    expect(selectionBox(state({ ...here, h: 0 }), 0)).toBeUndefined();
    expect(selectionBox(state(here), 3)).toBeUndefined();
  });
});

describe("framing a district", () => {
  const base = {
    rect: { x: 100, y: 200, w: 60, h: 80 },
    size: 1000,
    perspective: true,
    fovDeg: 35,
    freeAspect: 1.5,
    distance: 900,
    zoom: 1,
    orthoHeight: 1.28,
  };

  it("looks at the middle of the district", () => {
    expect(districtView(base).target).toEqual({ x: 130, z: 240 });
  });

  it("stands closer for a smaller district, but never closer than a small share of the city", () => {
    const big = districtView({ ...base, rect: { x: 0, y: 0, w: 600, h: 600 } });
    const small = districtView({ ...base, rect: { x: 0, y: 0, w: 60, h: 60 } });
    const tiny = districtView({ ...base, rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect(small.distance).toBeLessThan(big.distance);
    expect(tiny.distance).toBe(60);
  });

  it("stands farther when the free area is narrow, so that the district still fits", () => {
    const wide = districtView({ ...base, freeAspect: 1.6 });
    const narrow = districtView({ ...base, freeAspect: 0.5 });
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it("zooms an orthographic view instead, and leaves its distance alone", () => {
    const view = districtView({ ...base, perspective: false });
    expect(view.distance).toBe(900);
    expect(view.zoom).toBeGreaterThan(1);
    const smaller = districtView({ ...base, perspective: false, rect: { x: 0, y: 0, w: 30, h: 40 } });
    expect(smaller.zoom).toBeGreaterThan(view.zoom);
  });
});
