import type { Layout } from "@factory-city/layout";
import { describe, expect, it } from "vitest";
import { districtLabels, type Projector, placeLabels } from "../src/view/district-labels";

const layout: Layout = {
  width: 100,
  height: 100,
  files: new Map(),
  folders: new Map([
    ["", { x: 0, y: 0, w: 100, h: 100 }],
    ["app", { x: 0, y: 0, w: 60, h: 100 }],
    ["lib", { x: 60, y: 0, w: 40, h: 100 }],
    ["app/ui", { x: 0, y: 0, w: 30, h: 50 }],
  ]),
};

/** A flat map seen from above: one world unit is `k` pixels. */
const plan = (k: number, blocked: (x: number, y: number) => boolean = () => false): Projector => ({
  project: (x, _y, z) => ({ x: x * k, y: z * k }),
  blocked,
});
const label = { w: 40, h: 14 };
const free = { x: 0, y: 0, w: 2000, h: 2000 };

describe("district labels", () => {
  it("lists every district but the root, shallow and big first", () => {
    expect(districtLabels(layout).map((l) => l.path)).toEqual(["app", "lib", "app/ui"]);
  });

  it("names the top-level districts under the edge nearest to the viewer", () => {
    const placed = placeLabels(districtLabels(layout), plan(5), () => label, free);
    const app = placed.find((l) => l.path === "app");
    expect(app).toBeDefined();
    // the bottom edge of the plan (largest y) is the nearest: the name hangs below it, centered
    expect(app?.box.y).toBeGreaterThan(100 * 5);
    expect(app?.box.x).toBeCloseTo(30 * 5 - label.w / 2);
  });

  it("names a deeper district only when its edge is wide enough, so it appears as the camera comes closer", () => {
    const far = placeLabels(districtLabels(layout), plan(1), () => label, free);
    const near = placeLabels(districtLabels(layout), plan(5), () => label, free);
    expect(far.map((l) => l.path)).not.toContain("app/ui");
    expect(near.map((l) => l.path)).toContain("app/ui");
    // top-level names stay at any distance
    expect(far.map((l) => l.path)).toEqual(expect.arrayContaining(["app", "lib"]));
  });

  it("never covers a building: a name whose box meets one is not shown", () => {
    const placed = placeLabels(
      districtLabels(layout),
      plan(5, () => true),
      () => label,
      free,
    );
    expect(placed).toEqual([]);
    // only the districts whose name would land on a building are left unnamed
    const some = placeLabels(
      districtLabels(layout),
      plan(5, (_x, y) => y > 500),
      () => label,
      free,
    );
    expect(some.map((l) => l.path)).toEqual(["app/ui"]);
  });

  it("never overlaps another name, and stays out of what the panels hide", () => {
    const wide = { w: 400, h: 14 };
    const placed = placeLabels(districtLabels(layout), plan(5), () => wide, free);
    for (const [i, a] of placed.entries())
      for (const b of placed.slice(i + 1))
        expect(a.box.x + a.box.w <= b.box.x || b.box.x + b.box.w <= a.box.x).toBe(true);
    const narrow = { x: 0, y: 0, w: 200, h: 2000 };
    for (const p of placeLabels(districtLabels(layout), plan(5), () => label, narrow))
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(200);
  });
});
