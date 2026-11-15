import { computeLayout } from "@factory-city/layout";
import { describe, expect, it } from "vitest";
import { contrastRatio, distance, luminance, simulate } from "../src/lib/contrast";
import { defaultMapping } from "../src/presets/index";
import architect from "../src/themes/architect.json";
import { REQUIRED_COLORS, THEMES, type Theme, themeById, validateTheme } from "../src/themes/index";
import { cssSteps, parseHex } from "../src/view/color";
import { legendLines } from "../src/view/legend";
import { computePlacements } from "../src/view/placements";
import { blockLegend, blockSize, blocksHigh, voxelize } from "../src/view/voxel";
import { makeModel, SAMPLE } from "./helpers";

const model = makeModel(SAMPLE, { categories: { language: ["typescript", "tsx"], is_test: ["no", "yes"] } });
const layout = computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values.rloc ?? 1 })));
const { mapping } = defaultMapping(model);
const hex = (theme: Theme, key: string) => parseHex(theme.colors[key] as string);

describe("the four themes", () => {
  it("ships two sober themes, one made of blocks and one futuristic, on three renderers", () => {
    expect(THEMES.map((t) => `${t.id}:${t.renderer}`)).toEqual([
      "architect:solid",
      "isometric:solid",
      "blocks:voxel",
      "hologram:wireframe",
    ]);
    expect(THEMES[0]?.label).toBe("Architect's Model");
    expect(themeById("hologram")?.mode).toBe("dark");
    expect(themeById("nope")).toBeUndefined();
  });

  it("defines every token the scene and the style sheets read", () => {
    for (const theme of THEMES)
      for (const key of REQUIRED_COLORS)
        expect(theme.colors[key], `${theme.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("gives the marker a color of its own: not a stop of the ramp, the accent or a building", () => {
    for (const theme of THEMES) {
      const marker = theme.colors.marker;
      expect(marker, theme.id).toBeDefined();
      const taken = [
        ...theme.ramps.sequential,
        theme.colors.accent,
        theme.colors.building,
        theme.colors.unavailable,
      ];
      expect(taken, theme.id).not.toContain(marker);
    }
  });

  it("renders the same data with the same legend content", () => {
    const legends = THEMES.map((theme) => {
      const { legend } = computePlacements(model, layout, mapping, theme);
      return JSON.stringify({
        lines: legendLines(model, mapping, theme.mode).map((l) => ({
          ...l,
          text: l.text.replace("brighter", "darker"),
        })),
        kind: legend.kind,
        metric: legend.metric,
        min: legend.min,
        max: legend.max,
      });
    });
    expect(new Set(legends).size).toBe(1);
    const byLanguage = { ...mapping, color: "language" };
    const labels = THEMES.map((theme) =>
      JSON.stringify(
        computePlacements(model, layout, byLanguage, theme).legend.categories?.map((c) => [c.label, c.count]),
      ),
    );
    expect(new Set(labels).size).toBe(1);
  });

  it("words the color scale for the background: darker on light themes, brighter on the dark one", () => {
    expect(legendLines(model, mapping, "light").at(-1)?.text).toBe("darker = deeper nesting");
    expect(legendLines(model, mapping, "dark").at(-1)?.text).toBe("brighter = deeper nesting");
  });

  it("keeps the same data mapping: same footprints and heights in every solid and wireframe theme", () => {
    const shape = (theme: Theme) =>
      computePlacements(model, layout, mapping, theme).placements.map((p) => [p?.w, p?.d, p?.x, p?.z]);
    expect(shape(themeById("isometric") as Theme)).toEqual(shape(THEMES[0] as Theme));
    expect(shape(themeById("hologram") as Theme)).toEqual(shape(THEMES[0] as Theme));
  });

  it("keeps the sober themes free of glow, grid and bloom", () => {
    for (const id of ["architect", "isometric"]) {
      const theme = themeById(id) as Theme;
      expect(theme.effects?.glow ?? 0).toBe(0);
      expect(theme.effects?.grid ?? false).toBe(false);
      expect(theme.font).toContain("system-ui");
    }
    expect(themeById("isometric")).toMatchObject({
      camera: { type: "orthographic" },
      light: { shadows: false, sun: 0 },
    });
  });

  it("caps the Hologram glow and uses a monospace font and a ground grid", () => {
    const hologram = themeById("hologram") as Theme;
    expect(hologram.effects?.glow).toBeLessThanOrEqual(0.6);
    expect(hologram.effects?.grid).toBe(true);
    expect(hologram.font).toContain("monospace");
    expect(luminance(hex(hologram, "background"))).toBeLessThan(0.02);
  });
});

describe("contrast and color vision checks, on each theme's background", () => {
  for (const theme of THEMES) {
    it(`${theme.label}: text is readable on its panel`, () => {
      expect(contrastRatio(hex(theme, "text"), hex(theme, "panel"))).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(hex(theme, "textMuted"), hex(theme, "panel"))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex(theme, "accentText"), hex(theme, "accent"))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex(theme, "accent"), hex(theme, "panel"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme.label}: the sequential ramp gets steadily ${theme.mode === "dark" ? "lighter" : "darker"}, so it reads without hue`, () => {
      const l = theme.ramps.sequential.map((c) => luminance(parseHex(c)));
      for (let i = 1; i < l.length; i++) {
        if (theme.mode === "dark") expect(l[i] as number, `stop ${i}`).toBeGreaterThan(l[i - 1] as number);
        else expect(l[i] as number, `stop ${i}`).toBeLessThan(l[i - 1] as number);
      }
      // and its strong end stands out from the ground it is drawn on
      const strong = parseHex(theme.ramps.sequential.at(-1) as string);
      expect(contrastRatio(strong, hex(theme, "ground"))).toBeGreaterThanOrEqual(3);
    });

    it(`${theme.label}: the ends of the diverging ramp stay apart for red-green color vision deficiencies`, () => {
      const first = parseHex(theme.ramps.diverging[0] as string);
      const last = parseHex(theme.ramps.diverging.at(-1) as string);
      for (const d of ["protanopia", "deuteranopia"] as const)
        expect(distance(first, last, d), d).toBeGreaterThan(0.2);
    });

    it(`${theme.label}: categories are told apart by the roof mark too, never by color alone`, () => {
      const { legend } = computePlacements(model, layout, { ...mapping, color: "language" }, theme);
      const marks = legend.categories?.map((c) => c.roofMark) ?? [];
      expect(new Set(marks).size).toBe(marks.length);
      // and the palette itself keeps neighbours apart
      const palette = theme.ramps.categorical.map(parseHex);
      for (let i = 1; i < palette.length; i++)
        expect(distance(palette[i - 1] as never, palette[i] as never), `${i}`).toBeGreaterThan(0.08);
    });

    it(`${theme.label}: risk levels get steadily stronger, so the bars read in gray too`, () => {
      const l = ["riskLow", "riskModerate", "riskHigh", "riskVeryHigh"].map((k) => luminance(hex(theme, k)));
      const order = theme.mode === "dark" ? l : [...l].reverse();
      for (let i = 1; i < order.length; i++)
        expect(order[i] as number, `level ${i}`).toBeGreaterThan(order[i - 1] as number);
    });
  }

  it("measures contrast and simulates color vision as expected", () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio([1, 1, 1], [1, 1, 1])).toBe(1);
    // pure red and pure green come much closer for a deuteranope
    expect(distance([1, 0, 0], [0, 1, 0], "deuteranopia")).toBeLessThan(distance([1, 0, 0], [0, 1, 0]) * 0.6);
    expect(simulate([1, 1, 1], "protanopia").every((c) => Math.abs(c - 1) < 0.01)).toBe(true);
  });
});

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
