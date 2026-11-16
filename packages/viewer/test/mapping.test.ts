import { computeLayout } from "@factory-city/layout";
import { expect, it } from "vitest";
import { defaultMapping, presetStatus, presetStatuses } from "../src/presets/index";
import { DEFAULT_THEME } from "../src/themes/index";
import { computePlacements, plinthTop } from "../src/view/placements";
import { makeModel, SAMPLE } from "./helpers";

const model = makeModel(SAMPLE, { categories: { language: ["typescript", "tsx"], is_test: ["no", "yes"] } });

it("presets > offers Structure by default, falling back to nesting when coupling is absent", () => {
  const { preset, mapping } = defaultMapping(model);
  expect(preset.id).toBe("structure");
  expect(mapping).toMatchObject({ area: "rloc", height: "mcc", color: "max_nesting_level" });
});

it("presets > uses imports_out when the snapshot has it", () => {
  const withImports = makeModel(SAMPLE.map((s) => ({ ...s, values: { ...s.values, imports_out: 2 } })));
  expect(defaultMapping(withImports).mapping.color).toBe("imports_out");
});

it("presets > lists a preset as unavailable, with the reason, when its metrics cover under half of the code", () => {
  const sparse = makeModel([
    { path: "a.ts", values: { rloc: 100, mcc: 5 } },
    { path: "b.ts", values: { rloc: 100 } },
    { path: "c.ts", values: { rloc: 100 } },
  ]);
  const status = presetStatus(sparse, presetStatuses(sparse)[0]?.preset as never);
  expect(status.available).toBe(false);
  expect(status.reason).toContain("mcc");
});

it("presets > lists Duplication as unavailable until it is computed, and says how to get it", () => {
  const find = (m: typeof model) => presetStatuses(m).find((s) => s.preset.id === "duplication");
  const without = find(model);
  expect(without?.available).toBe(false);
  expect(without?.reason).toContain("--with duplication");
  const computed = makeModel(SAMPLE.map((s) => ({ ...s, values: { ...s.values, duplication_ratio: 0.1 } })));
  expect(find(computed)).toMatchObject({ available: true, mapping: { color: "duplication_ratio" } });
});

const layout = computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values.rloc ?? 1 })));
const { mapping } = defaultMapping(model);

it("placements > keeps every building inside its parcel", () => {
  const { placements } = computePlacements(model, layout, mapping, DEFAULT_THEME);
  placements.forEach((p, i) => {
    const rect = layout.files.get(model.files[i]?.path as string);
    expect(p && rect).toBeTruthy();
    if (!p || !rect) return;
    expect(p.x - p.w / 2).toBeGreaterThanOrEqual(rect.x);
    expect(p.x + p.w / 2).toBeLessThanOrEqual(rect.x + rect.w);
    expect(p.z - p.d / 2).toBeGreaterThanOrEqual(rect.y);
    expect(p.z + p.d / 2).toBeLessThanOrEqual(rect.y + rect.h);
  });
});

it("placements > makes complex files taller and stands buildings on their folder's plinth", () => {
  const { placements } = computePlacements(model, layout, mapping, DEFAULT_THEME);
  const at = (path: string) => placements[model.filesByPath.get(path) as number];
  expect((at("src/a.ts")?.h ?? 0) > (at("src/b.ts")?.h ?? 0)).toBe(true);
  expect(at("src/a.ts")?.baseY).toBe(plinthTop(1));
  expect(at("src/deep/c.tsx")?.baseY).toBe(plinthTop(2));
});

it("placements > marks a missing color value as unavailable, never as zero", () => {
  const m = { ...mapping, color: "max_function_complexity" };
  const { placements } = computePlacements(model, layout, m, DEFAULT_THEME);
  const constFile = placements[model.filesByPath.get("src/const.ts") as number];
  expect(constFile?.colorUnavailable).toBe(true);
});

it("placements > gives categories a palette slot and a roof mark, with at most 8 colors plus other", () => {
  const many = makeModel(
    Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.ts`, values: { rloc: 10, mcc: 1, language: i } })),
  );
  const l = computeLayout(many.files.map((f) => ({ path: f.path, weight: 10 })));
  const { legend } = computePlacements(
    many,
    l,
    { area: "rloc", height: "mcc", color: "language", scale: "linear", clampP99: false },
    DEFAULT_THEME,
  );
  expect(legend.kind).toBe("categorical");
  expect(legend.categories).toHaveLength(9);
  expect(legend.categories?.at(-1)?.label).toBe("other");
  expect(new Set(legend.categories?.map((c) => c.roofMark)).size).toBe(9);
});

it("placements > describes the numeric range of a sequential color", () => {
  const { legend } = computePlacements(model, layout, mapping, DEFAULT_THEME);
  expect(legend).toMatchObject({ kind: "sequential", metric: "max_nesting_level", min: 0 });
});
