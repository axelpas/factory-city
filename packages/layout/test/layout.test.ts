import { expect, it } from "vitest";
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

it("computeLayout > gives the same map for the same input, whatever the order", () => {
  const one = computeLayout(FILES);
  const two = computeLayout([...FILES].reverse());
  expect(Object.fromEntries(one.files)).toEqual(Object.fromEntries(two.files));
  expect(Object.fromEntries(one.folders)).toEqual(Object.fromEntries(two.folders));
});

it("computeLayout > places every file and every folder", () => {
  const layout = computeLayout(FILES);
  expect(layout.files.size).toBe(FILES.length);
  expect([...layout.folders.keys()].sort()).toEqual(["", "src", "src/deep", "test"]);
});

/** The files after `path` in order whose parcel overlaps the given one. */
function overlappingPaths(path: string, rect: Rect, rects: Array<[string, Rect]>): string[] {
  return rects.filter(([other, r]) => path < other && overlaps(rect, r)).map(([other]) => other);
}

it("computeLayout > keeps parcels disjoint and inside their folder", () => {
  const layout = computeLayout(FILES);
  const rects = [...layout.files.entries()];
  for (const [pa, a] of rects) {
    expect(overlappingPaths(pa, a, rects), pa).toEqual([]);
    const folder = pa.includes("/") ? pa.slice(0, pa.lastIndexOf("/")) : "";
    expect(inside(a, layout.folders.get(folder) as Rect), pa).toBe(true);
  }
});

it("computeLayout > leaves a street between sibling folders, wider at the top of the tree", () => {
  const layout = computeLayout([
    { path: "a/x.ts", weight: 50 },
    { path: "a/deep/y.ts", weight: 50 },
    { path: "a/deeper/z.ts", weight: 50 },
    { path: "b/w.ts", weight: 150 },
  ]);
  const gap = (p: string, q: string) => {
    const a = layout.folders.get(p) as Rect;
    const b = layout.folders.get(q) as Rect;
    return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  };
  const top = gap("a", "b");
  const nested = gap("a/deep", "a/deeper");
  // default street: 0.9% of the map on each side, so 18 units between two top-level folders
  expect(top).toBeGreaterThanOrEqual(18);
  expect(nested).toBeGreaterThan(0);
  expect(nested).toBeLessThan(top);
  for (const p of ["a", "b", "a/deep", "a/deeper"]) {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    expect(inside(layout.folders.get(p) as Rect, layout.folders.get(parent) as Rect), p).toBe(true);
  }
  // no street when asked for none: folders touch but for the parcel padding
  const tight = computeLayout(
    [
      { path: "a/x.ts", weight: 50 },
      { path: "b/w.ts", weight: 150 },
    ],
    { street: 0 },
  );
  const a = tight.folders.get("a") as Rect;
  const b = tight.folders.get("b") as Rect;
  expect(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))).toBeLessThan(
    2,
  );
});

it("computeLayout > gives heavier files larger parcels", () => {
  const layout = computeLayout(FILES);
  const area = (p: string) => {
    const r = layout.files.get(p) as Rect;
    return r.w * r.h;
  };
  expect(area("src/a.ts")).toBeGreaterThan(area("src/b.ts"));
  expect(area("src/b.ts")).toBeGreaterThan(area("src/deep/d.ts"));
});

it("computeLayout > handles an empty input, a single file and zero weights", () => {
  expect(computeLayout([]).files.size).toBe(0);
  const one = computeLayout([{ path: "a.ts", weight: 3 }]);
  expect(one.files.get("a.ts")).toBeDefined();
  const zero = computeLayout([
    { path: "a.ts", weight: 0 },
    { path: "b.ts", weight: Number.NaN },
  ]);
  for (const r of zero.files.values()) expect(r.w * r.h).toBeGreaterThan(0);
});

it("computeLayout > is stable when a file is added: other files keep their order of magnitude", () => {
  const base = computeLayout(FILES);
  const more = computeLayout([...FILES, { path: "src/new.ts", weight: 1 }]);
  expect(more.files.size).toBe(base.files.size + 1);
});
