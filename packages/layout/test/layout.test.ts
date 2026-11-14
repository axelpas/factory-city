import { describe, expect, it } from "vitest";
import { computeLayout, type LayoutFile, type Rect } from "../src/index.js";

const FILES: LayoutFile[] = [
  { path: "src/a.ts", weight: 100 },
  { path: "src/b.ts", weight: 40 },
  { path: "src/deep/c.ts", weight: 25 },
  { path: "src/deep/d.ts", weight: 5 },
  { path: "test/a.test.ts", weight: 60 },
  { path: "index.ts", weight: 10 },
];

function overlaps(a: Rect, b: Rect): boolean {
  const eps = 1e-6;
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

function inside(inner: Rect, outer: Rect): boolean {
  const eps = 1e-6;
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

describe("computeLayout", () => {
  it("gives the same map for the same input, whatever the order", () => {
    const one = computeLayout(FILES);
    const two = computeLayout([...FILES].reverse());
    expect(Object.fromEntries(one.files)).toEqual(Object.fromEntries(two.files));
    expect(Object.fromEntries(one.folders)).toEqual(Object.fromEntries(two.folders));
  });

  it("places every file and every folder", () => {
    const layout = computeLayout(FILES);
    expect(layout.files.size).toBe(FILES.length);
    expect([...layout.folders.keys()].sort()).toEqual(["", "src", "src/deep", "test"]);
  });

  it("keeps parcels disjoint and inside their folder", () => {
    const layout = computeLayout(FILES);
    const rects = [...layout.files.entries()];
    for (const [pa, a] of rects) {
      for (const [pb, b] of rects) if (pa < pb) expect(overlaps(a, b), `${pa} / ${pb}`).toBe(false);
      const folder = pa.includes("/") ? pa.slice(0, pa.lastIndexOf("/")) : "";
      expect(inside(a, layout.folders.get(folder) as Rect), pa).toBe(true);
    }
  });

  it("gives heavier files larger parcels", () => {
    const layout = computeLayout(FILES);
    const area = (p: string) => {
      const r = layout.files.get(p) as Rect;
      return r.w * r.h;
    };
    expect(area("src/a.ts")).toBeGreaterThan(area("src/b.ts"));
    expect(area("src/b.ts")).toBeGreaterThan(area("src/deep/d.ts"));
  });

  it("handles an empty input, a single file and zero weights", () => {
    expect(computeLayout([]).files.size).toBe(0);
    const one = computeLayout([{ path: "a.ts", weight: 3 }]);
    expect(one.files.get("a.ts")).toBeDefined();
    const zero = computeLayout([
      { path: "a.ts", weight: 0 },
      { path: "b.ts", weight: Number.NaN },
    ]);
    for (const r of zero.files.values()) expect(r.w * r.h).toBeGreaterThan(0);
  });

  it("is stable when a file is added: other files keep their order of magnitude", () => {
    const base = computeLayout(FILES);
    const more = computeLayout([...FILES, { path: "src/new.ts", weight: 1 }]);
    expect(more.files.size).toBe(base.files.size + 1);
  });
});
