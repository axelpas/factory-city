import { describe, expect, it } from "vitest";
import { percentileRank, statsOf } from "../src/data/model";
import { makeModel, SAMPLE } from "./helpers";

describe("buildModel", () => {
  const model = makeModel(SAMPLE, {
    categories: { language: ["typescript", "tsx"], is_test: ["no", "yes"] },
  });

  it("lists files with their paths, folders and values", () => {
    expect(model.files.map((f) => f.path)).toContain("src/deep/c.tsx");
    const c = model.files[model.filesByPath.get("src/deep/c.tsx") as number];
    expect(c?.dir).toBe("src/deep");
    expect(c?.values.rloc).toBe(25);
  });

  it("flags test files", () => {
    expect(model.files.find((f) => f.path === "test/a.test.ts")?.isTest).toBe(true);
    expect(model.files.find((f) => f.path === "src/a.ts")?.isTest).toBe(false);
  });

  it("counts a file in every ancestor folder", () => {
    expect(model.folders.get("")?.files).toHaveLength(5);
    expect(model.folders.get("src")?.files).toHaveLength(4);
    expect(model.folders.get("src/deep")?.rloc).toBe(25);
  });

  it("builds statistics and coverage per metric", () => {
    expect(model.stats.get("mcc")?.max).toBe(30);
    expect(model.coverage.get("rloc")).toBe(1);
    // const.ts (8 lines of 213) has no max_function_complexity
    expect(model.coverage.get("max_function_complexity")).toBeCloseTo(205 / 213, 5);
  });

  it("describes unknown metrics instead of failing", () => {
    const m = makeModel([{ path: "a.ts", values: { rloc: 1, weird_metric: 3 } }]);
    expect(m.metrics.get("weird_metric")?.label).toBe("weird metric");
  });

  it("ranks values in the city", () => {
    const stats = statsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(percentileRank(stats, 5)).toBe(0.5);
    expect(percentileRank(stats, 10)).toBe(1);
    expect(percentileRank(stats, 0)).toBe(0);
  });
});
