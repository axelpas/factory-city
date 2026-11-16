import { describe, expect, it } from "vitest";
import architect from "../src/themes/architect.json";
import { THEMES, type Theme, themeById, validateTheme } from "../src/themes/index";
import { cssSteps, parseHex } from "../src/view/color";
import { computePlacements } from "../src/view/placements";
import { blockLegend, blockSize, blocksHigh, voxelize } from "../src/view/voxel";
import { layout, mapping, model } from "./themes-helpers";

describe("a fifth theme added as a token file alone", () => {
  const fifth = validateTheme({
    ...architect,
    id: "blueprint",
    label: "Blueprint",
    renderer: "wireframe",
    mode: "dark",
    colors: {
      ...architect.colors,
      background: "#0b2545",
      ground: "#0b2545",
      building: "#cfe8ff",
      text: "#eaf4ff",
      panel: "#0f2d55",
    },
    effects: { faceAlpha: 0.2 },
  });

  it("is accepted and draws the same data, with no scene or viewer code", () => {
    const base = computePlacements(model, layout, mapping, THEMES[0] as Theme);
    const mine = computePlacements(model, layout, mapping, fifth);
    expect(mine.legend).toEqual(base.legend);
    expect(mine.placements.map((p) => p?.h)).toEqual(base.placements.map((p) => p?.h));
    // the building color comes from the new token
    const white = { ...mapping, color: null };
    expect(computePlacements(model, layout, white, fifth).placements[0]?.color).toEqual(parseHex("#cfe8ff"));
  });

  it("is rejected with the name of the wrong token", () => {
    expect(() => validateTheme({ ...architect, renderer: "hologram" })).toThrow(
      /renderer must be one of solid, voxel, wireframe/,
    );
    expect(() => validateTheme({ ...architect, colors: { ...architect.colors, text: "white" } })).toThrow(
      /colors\.text must be a hex color/,
    );
    expect(() =>
      validateTheme({ ...architect, ramps: { ...architect.ramps, sequential: ["#fff"] } }),
    ).toThrow(/ramps\.sequential must hold 2 to 8 hex colors/);
    expect(() => validateTheme({ ...architect, effects: { grid: true } })).toThrow(
      /colors\.gridLine is needed/,
    );
    expect(() => validateTheme(null)).toThrow(/a theme is an object of tokens/);
  });
});

describe("Blocks", () => {
  const theme = themeById("blocks") as Theme;
  const block = blockSize(theme, 1000) as number;
  const base = {
    x: 100,
    z: 100,
    w: 40,
    d: 31,
    h: 50,
    baseY: 1,
    color: [1, 1, 1] as [number, number, number],
    marked: false,
    roofMark: 0,
    heightUnavailable: false,
    colorUnavailable: false,
  };
  const parcel = { x: 70, y: 70, w: 60, h: 60 };

  it("has a block size only for the theme made of blocks", () => {
    expect(block).toBe(12);
    expect(blockSize(THEMES[0] as Theme, 1000)).toBeUndefined();
  });

  it("rounds heights to whole blocks, at least one", () => {
    expect(voxelize(base, parcel, block, theme).h).toBe(48); // 50 / 12 = 4.17 blocks
    expect(voxelize({ ...base, h: 55 }, parcel, block, theme).h).toBe(60);
    expect(voxelize({ ...base, h: 2 }, parcel, block, theme).h).toBe(12);
    expect(blocksHigh(50, block)).toBe(4);
  });

  it("snaps footprints to whole cells on the grid", () => {
    const v = voxelize(base, parcel, block, theme);
    expect(v.w).toBe(36);
    expect(v.d).toBe(24);
    expect((v.x - v.w / 2) % block).toBeCloseTo(0, 6);
    expect((v.z - v.d / 2) % block).toBeCloseTo(0, 6);
  });

  it("never lets a snapped building leave its parcel, and keeps a tiny parcel's footprint", () => {
    for (const x of [72, 100, 128]) {
      const v = voxelize({ ...base, x, w: 55, d: 55 }, parcel, block, theme);
      expect(v.x - v.w / 2).toBeGreaterThanOrEqual(parcel.x - 1e-9);
      expect(v.x + v.w / 2).toBeLessThanOrEqual(parcel.x + parcel.w + 1e-9);
    }
    const tiny = voxelize({ ...base, w: 5, d: 7 }, { x: 97, y: 96, w: 6, h: 8 }, block, theme);
    expect([tiny.w, tiny.d]).toEqual([5, 7]);
  });

  it("shows the color metric in 5 discrete steps", () => {
    const seen = new Set<string>();
    for (let i = 0; i <= 100; i++)
      seen.add(JSON.stringify(voxelize({ ...base, ramp: i / 100 }, parcel, block, theme).color));
    expect(seen.size).toBe(5);
    expect(voxelize({ ...base, ramp: 1 }, parcel, block, theme).ramp).toBe(1);
    expect(voxelize({ ...base, ramp: 0.1 }, parcel, block, theme).ramp).toBe(0);
    expect(cssSteps([parseHex("#000000"), parseHex("#ffffff")], 2)).toBe(
      "linear-gradient(to right, rgb(0 0 0) 0%, rgb(0 0 0) 50%, rgb(255 255 255) 50%, rgb(255 255 255) 100%)",
    );
  });

  it("says in the legend what one block is worth", () => {
    const stats = { min: 0, max: 400, p99: 300 };
    const n = (x: number) => String(x);
    expect(blockLegend("Complexity", stats, "linear", true, 120, 12, n)).toBe(
      "Heights are rounded to whole blocks: one block = 30 of complexity.",
    );
    expect(blockLegend("Complexity", stats, "linear", false, 120, 12, n)).toBe(
      "Heights are rounded to whole blocks: one block = 40 of complexity.",
    );
    expect(blockLegend("Complexity", stats, "sqrt", true, 120, 12, n)).toBe(
      "Heights are rounded to whole blocks on a sqrt scale: 10 blocks = 300 of complexity.",
    );
    expect(blockLegend("Complexity", undefined, "linear", true, 120, 12, n)).toBe(
      "Heights are rounded to whole blocks.",
    );
  });

  it("prefers a linear scale, and uses no asset: only tokens", () => {
    expect(theme.scale).toBe("linear");
    expect(JSON.stringify(theme)).not.toMatch(/\.(png|jpg|jpeg|gif|svg|woff2?|ttf|mp3|ogg|wav)/i);
  });
});
