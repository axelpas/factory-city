import { computeLayout } from "@factory-city/layout";
import { describe, expect, it } from "vitest";
import { createFormat } from "../src/lib/format";
import { defaultMapping, PRESETS, presetStatus, presetStatuses } from "../src/presets/index";
import { DEFAULT_THEME } from "../src/themes/index";
import { fileCard, folderCard } from "../src/view/card";
import { legendLines } from "../src/view/legend";
import { computePlacements, computeTints, MAX_TWIST } from "../src/view/placements";
import { type FileSpec, makeModel } from "./helpers";

const fmt = createFormat(["en-US"]);

const FILES: FileSpec[] = [
  {
    path: "core/a.ts",
    values: {
      rloc: 200,
      mcc: 40,
      imports_out: 6,
      imports_in: 1,
      cohesion_groups: 4,
      lack_of_cohesion: 1,
      escape_hatches: 6,
      escape_hatch_density: 30,
    },
  },
  {
    path: "core/b.ts",
    values: {
      rloc: 100,
      mcc: 10,
      imports_out: 2,
      imports_in: 3,
      cohesion_groups: 1,
      lack_of_cohesion: 0,
      escape_hatches: 0,
      escape_hatch_density: 0,
    },
  },
  {
    path: "core/c.ts",
    values: {
      rloc: 50,
      mcc: 6,
      imports_out: 1,
      imports_in: 2,
      cohesion_groups: 2,
      lack_of_cohesion: 0.5,
      escape_hatches: 1,
      escape_hatch_density: 20,
    },
  },
  {
    path: "ui/x.ts",
    values: {
      rloc: 80,
      mcc: 9,
      imports_out: 3,
      imports_in: 0,
      cohesion_groups: 1,
      lack_of_cohesion: 0,
      escape_hatches: 0,
      escape_hatch_density: 0,
    },
  },
];
const model = makeModel(FILES, undefined, { core: { folder_cohesion: 0.8 }, ui: { folder_cohesion: 0.2 } });
const layout = computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values.rloc ?? 1 })));

describe("design presets", () => {
  it("offers the four code presets when their metrics are present", () => {
    const available = presetStatuses(model)
      .filter((s) => s.available)
      .map((s) => s.preset.id);
    expect(available).toEqual(expect.arrayContaining(["structure", "cohesion", "three-cs", "shortcuts"]));
  });

  it("maps Structure to coupling, Cohesion to lack of cohesion with a tint, Three Cs to coupling with twist", () => {
    const get = (id: string) => presetStatus(model, PRESETS.find((p) => p.id === id) as never).mapping;
    expect(get("structure")).toMatchObject({
      area: "rloc",
      height: "mcc",
      color: "imports_out",
      twist: null,
    });
    expect(get("cohesion")).toMatchObject({
      color: "lack_of_cohesion",
      tint: "folder_cohesion",
      twist: null,
    });
    expect(get("three-cs")).toMatchObject({ color: "imports_out", twist: "lack_of_cohesion", tint: null });
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

describe("twist", () => {
  const { mapping } = defaultMapping(model);
  const twisted = { ...mapping, color: "imports_out", twist: "lack_of_cohesion" };

  it("turns buildings by up to a quarter turn, in proportion to their lack of cohesion", () => {
    const { placements } = computePlacements(model, layout, twisted, DEFAULT_THEME);
    const at = (p: string) => placements[model.filesByPath.get(p) as number];
    expect(at("core/b.ts")?.twist).toBe(0);
    expect(at("core/c.ts")?.twist).toBeCloseTo(MAX_TWIST / 2, 10);
    expect(at("core/a.ts")?.twist).toBeCloseTo(MAX_TWIST, 10);
  });

  it("does not twist when the channel is off", () => {
    const { placements } = computePlacements(model, layout, { ...mapping, twist: null }, DEFAULT_THEME);
    expect(placements.every((p) => p?.twist === 0)).toBe(true);
  });

  it("keeps a fully twisted building inside its parcel, whatever the parcel shape", () => {
    const shapes = [
      { w: 100, h: 100 },
      { w: 300, h: 20 },
      { w: 20, h: 300 },
      { w: 1, h: 1000 },
    ];
    for (const shape of shapes) {
      const m = makeModel([{ path: "a.ts", values: { rloc: 1, mcc: 1, lack_of_cohesion: 1 } }]);
      const l = {
        width: 1000,
        height: 1000,
        folders: new Map(),
        files: new Map([["a.ts", { x: 10, y: 20, w: shape.w, h: shape.h }]]),
      };
      const { placements } = computePlacements(
        m,
        l,
        {
          area: "rloc",
          height: "mcc",
          color: null,
          twist: "lack_of_cohesion",
          tint: null,
          scale: "linear",
          clampP99: false,
        },
        DEFAULT_THEME,
      );
      const p = placements[0];
      expect(p).toBeDefined();
      if (!p) continue;
      const c = Math.cos(p.twist);
      const s = Math.sin(p.twist);
      const boxW = p.w * c + p.d * s;
      const boxD = p.w * s + p.d * c;
      expect(boxW, `${shape.w}x${shape.h}`).toBeLessThanOrEqual(shape.w + 1e-9);
      expect(boxD, `${shape.w}x${shape.h}`).toBeLessThanOrEqual(shape.h + 1e-9);
      expect(p.x - boxW / 2).toBeGreaterThanOrEqual(10 - 1e-9);
    }
  });

  it("shrinks every footprint by the same factor when twist is on", () => {
    const off = computePlacements(model, layout, { ...mapping, twist: null }, DEFAULT_THEME).placements;
    const on = computePlacements(model, layout, twisted, DEFAULT_THEME).placements;
    const b = model.filesByPath.get("core/b.ts") as number; // not twisted: pure shrink
    expect((on[b]?.w ?? 0) / (off[b]?.w ?? 1)).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("shows no twist for a file whose cohesion is unavailable", () => {
    const m = makeModel([{ path: "a.ts", values: { rloc: 10, mcc: 1 } }]);
    const l = computeLayout([{ path: "a.ts", weight: 10 }]);
    const { placements } = computePlacements(
      m,
      l,
      {
        area: "rloc",
        height: "mcc",
        color: null,
        twist: "lack_of_cohesion",
        tint: null,
        scale: "linear",
        clampP99: false,
      },
      DEFAULT_THEME,
    );
    expect(placements[0]?.twist).toBe(0);
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

describe("cards and legend for design metrics", () => {
  const { mapping } = defaultMapping(model);
  const m = { ...mapping, color: "imports_out", twist: "lack_of_cohesion" };

  it("shows the twist channel and the coupling on the file card", () => {
    const card = fileCard(model, model.filesByPath.get("core/a.ts") as number, m, fmt);
    expect(card.channels.map((c) => c.label)).toContain("Twist: Lack of cohesion");
    const other = fileCard(model, model.filesByPath.get("core/a.ts") as number, mapping, fmt);
    expect(other.metrics.map((r) => r.label)).toEqual(
      expect.arrayContaining(["Imported by", "Cohesion groups"]),
    );
  });

  it("shows folder cohesion on the folder card", () => {
    expect(folderCard(model, "core", fmt).rows).toContainEqual(
      expect.objectContaining({ label: "Folder cohesion", value: "0.8" }),
    );
    const noValue = makeModel(FILES, undefined, { core: { folder_cohesion: 0.8 } });
    expect(folderCard(noValue, "ui", fmt).rows).toContainEqual(expect.objectContaining({ value: "n/a" }));
  });

  it("explains twist and tint in plain language", () => {
    const text = legendLines(model, { ...m, tint: "folder_cohesion" }).map((l) => l.text);
    expect(text).toContain("more twisted = less cohesive");
    expect(text).toContain("darker ground = more self-contained");
  });
});
