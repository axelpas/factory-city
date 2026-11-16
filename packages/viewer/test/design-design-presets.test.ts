import { describe, expect, it } from "vitest";
import { MARK, STRIDE } from "../src/anim/transition";
import { defaultMapping, PRESETS, presetStatus, presetStatuses } from "../src/presets/index";
import { DEFAULT_THEME } from "../src/themes/index";
import {
  isMarked,
  type Marker,
  MIN_ROOF,
  markedCount,
  markStrength,
  resolveMarker,
} from "../src/view/marker";
import { computePlacements, computeTints, PARCEL_INSET } from "../src/view/placements";
import { buildState } from "../src/view/state";
import { FILES, layout, model } from "./design-helpers";
import { makeModel } from "./helpers";

describe("design presets", () => {
  it("offers the four code presets when their metrics are present", () => {
    const available = presetStatuses(model)
      .filter((s) => s.available)
      .map((s) => s.preset.id);
    expect(available).toEqual(expect.arrayContaining(["structure", "cohesion", "three-cs", "shortcuts"]));
  });

  it("maps Structure to coupling, Cohesion to lack of cohesion with a tint, Three Cs to coupling with a marker", () => {
    const get = (id: string) => presetStatus(model, PRESETS.find((p) => p.id === id) as never).mapping;
    expect(get("structure")).toMatchObject({
      area: "rloc",
      height: "mcc",
      color: "imports_out",
      marker: null,
    });
    expect(get("cohesion")).toMatchObject({
      color: "lack_of_cohesion",
      tint: "folder_cohesion",
      marker: null,
    });
    expect(get("three-cs")).toMatchObject({
      color: "imports_out",
      marker: { metric: "cohesion_groups", source: "top" },
      tint: null,
    });
    // with the report's risk dimensions, the threshold is the bound where "high" starts
    const withRisk = presetStatus(model, PRESETS.find((p) => p.id === "three-cs") as never, [
      { metric: "cohesion_groups", bounds: [1, 2, 4] },
    ]).mapping;
    expect(withRisk?.marker).toMatchObject({ metric: "cohesion_groups", threshold: 2, source: "risk" });
    expect(get("shortcuts")).toMatchObject({ color: "escape_hatch_density" });
  });

  it("keeps ground area = rloc and height = complexity in every preset", () => {
    for (const p of PRESETS) {
      expect([p.area, p.height]).toEqual(["rloc", "mcc"]);
    }
  });

  it("lists a preset as unavailable when under half of the code has the metric", () => {
    const sparse = makeModel([
      { path: "a.ts", values: { rloc: 100, mcc: 5, lack_of_cohesion: 0.2 } },
      { path: "b.ts", values: { rloc: 100, mcc: 5 } },
      { path: "c.ts", values: { rloc: 100, mcc: 5 } },
    ]);
    const statuses = presetStatuses(sparse);
    expect(statuses.find((s) => s.preset.id === "cohesion")).toMatchObject({ available: false });
    expect(statuses.find((s) => s.preset.id === "three-cs")?.reason).toContain("is not available");
  });

  it("stays available without the tint when too few folders have a value", () => {
    const noFolders = makeModel(FILES);
    const status = presetStatus(noFolders, PRESETS.find((p) => p.id === "cohesion") as never);
    expect(status.available).toBe(true);
    expect(status.mapping?.tint).toBeNull();
  });
});

describe("marker", () => {
  const { mapping } = defaultMapping(model);
  const DIMENSIONS = [{ metric: "cohesion_groups", bounds: [1, 2, 4] }];
  const cohesion = resolveMarker(model, "cohesion_groups", DIMENSIONS);
  const marked = (m: typeof mapping) =>
    computePlacements(model, layout, m, DEFAULT_THEME)
      .placements.map((p, i) => (p?.marked ? model.files[i]?.path : undefined))
      .filter((p) => p !== undefined);

  it("takes its threshold from the risk dimension of the metric: above the bound where high starts", () => {
    expect(cohesion).toMatchObject({ metric: "cohesion_groups", threshold: 2, source: "risk" });
    // 4 groups is above 2; 2 groups is moderate, not marked
    expect(marked({ ...mapping, marker: cohesion ?? null })).toEqual(["core/a.ts"]);
  });

  it("falls back to the top tenth when the metric has no risk dimension", () => {
    const top = resolveMarker(model, "imports_out");
    expect(top).toMatchObject({ source: "top" });
    expect(marked({ ...mapping, marker: top ?? null })).toEqual(["core/a.ts"]);
    // with equal values nothing is above the threshold: nothing is marked
    const flat = makeModel(FILES.map((f) => ({ ...f, values: { ...f.values, imports_out: 3 } })));
    expect(markedCount(flat, resolveMarker(flat, "imports_out") as Marker)).toBe(0);
  });

  it("makes the roof steeper as the value grows, from a visible minimum to a peak", () => {
    const m: Marker = { metric: "cohesion_groups", threshold: 1, peak: 5, source: "chosen" };
    expect(markStrength(1, m)).toBe(0); // at the threshold: not marked
    expect(markStrength(undefined, m)).toBe(0); // no value: never a roof
    expect(markStrength(2, m)).toBeCloseTo(MIN_ROOF + (1 - MIN_ROOF) * 0.25, 10);
    expect(markStrength(3, m)).toBeGreaterThan(markStrength(2, m));
    expect(markStrength(5, m)).toBe(1);
    expect(markStrength(40, m)).toBe(1); // an outlier does not go past the peak
    expect(markStrength(3, null)).toBe(0);
    // no room between the threshold and the peak: every marked file gets the steepest roof
    expect(markStrength(3, { ...m, peak: 1 })).toBe(1);
  });

  it("takes the peak from the 99th percentile of the metric, never below the threshold", () => {
    const high = resolveMarker(model, "cohesion_groups", DIMENSIONS);
    expect(high?.peak).toBeGreaterThanOrEqual(high?.threshold ?? 0);
    const chosen = resolveMarker(model, "cohesion_groups", DIMENSIONS, 99);
    expect(chosen?.peak).toBe(99);
  });

  it("uses a chosen threshold as it is", () => {
    const chosen = resolveMarker(model, "cohesion_groups", DIMENSIONS, 1);
    expect(chosen).toMatchObject({ metric: "cohesion_groups", threshold: 1, source: "chosen" });
    expect(marked({ ...mapping, marker: chosen ?? null })).toEqual(["core/a.ts", "core/c.ts"]);
  });

  it("marks nothing when the channel is off, and never a file without a value", () => {
    expect(marked({ ...mapping, marker: null })).toEqual([]);
    expect(isMarked(undefined, cohesion)).toBe(false);
    const m = makeModel([
      { path: "a.ts", values: { rloc: 10, mcc: 1 } },
      { path: "b.ts", values: { rloc: 10, mcc: 1, cohesion_groups: 5 } },
    ]);
    expect(markedCount(m, cohesion as Marker)).toBe(1);
  });

  it("leaves footprints alone: a building uses its whole parcel but the inset", () => {
    const off = computePlacements(model, layout, { ...mapping, marker: null }, DEFAULT_THEME).placements;
    const on = computePlacements(
      model,
      layout,
      { ...mapping, marker: cohesion ?? null },
      DEFAULT_THEME,
    ).placements;
    expect(on.map((p) => [p?.w, p?.d])).toEqual(off.map((p) => [p?.w, p?.d]));
    const rect = layout.files.get("core/a.ts");
    const a = on[model.filesByPath.get("core/a.ts") as number];
    expect(a?.w).toBeCloseTo((rect?.w ?? 0) * (1 - 2 * PARCEL_INSET), 10);
  });

  it("writes the mark into the state of the building", () => {
    const paths = model.files.map((f) => f.path);
    const { placements } = computePlacements(
      model,
      layout,
      { ...mapping, marker: cohesion ?? null },
      DEFAULT_THEME,
    );
    const state = buildState(paths, layout, placements, { dimColor: [0, 0, 0] });
    const at = (p: string) => state[(model.filesByPath.get(p) as number) * STRIDE + MARK];
    expect(at("core/a.ts")).toBe(1);
    expect(at("core/b.ts")).toBe(0);
  });
});

describe("district tint", () => {
  it("tints folders from a folder-scope metric, darker for higher values, and skips the root", () => {
    const { mapping } = defaultMapping(model);
    const tints = computeTints(model, { ...mapping, tint: "folder_cohesion" }, DEFAULT_THEME);
    expect([...tints.keys()].sort()).toEqual(["core", "ui"]);
    const lum = (c: number[]) => (c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0);
    expect(lum(tints.get("core") as number[])).toBeLessThan(lum(tints.get("ui") as number[]));
  });

  it("is empty when the channel is off", () => {
    const { mapping } = defaultMapping(model);
    expect(computeTints(model, mapping, DEFAULT_THEME).size).toBe(0);
  });
});
