import { expect, it } from "vitest";
import { contrastRatio, distance, luminance, simulate } from "../src/lib/contrast";
import { REQUIRED_COLORS, THEMES, type Theme, themeById } from "../src/themes/index";
import { parseHex } from "../src/view/color";
import { legendLines } from "../src/view/legend";
import { computePlacements } from "../src/view/placements";
import { hex, layout, mapping, model } from "./themes-helpers";

it("the four themes > ships two sober themes, one made of blocks and one futuristic, on three renderers", () => {
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

it("the four themes > defines every token the scene and the style sheets read", () => {
  for (const theme of THEMES)
    for (const key of REQUIRED_COLORS)
      expect(theme.colors[key], `${theme.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
});

it("the four themes > gives the marker a color of its own: not a stop of the ramp, the accent or a building", () => {
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

it("the four themes > renders the same data with the same legend content", () => {
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

it("the four themes > words the color scale for the background: darker on light themes, brighter on the dark one", () => {
  expect(legendLines(model, mapping, "light").at(-1)?.text).toBe("darker = deeper nesting");
  expect(legendLines(model, mapping, "dark").at(-1)?.text).toBe("brighter = deeper nesting");
});

it("the four themes > keeps the same data mapping: same footprints and heights in every solid and wireframe theme", () => {
  const shape = (theme: Theme) =>
    computePlacements(model, layout, mapping, theme).placements.map((p) => [p?.w, p?.d, p?.x, p?.z]);
  expect(shape(themeById("isometric") as Theme)).toEqual(shape(THEMES[0] as Theme));
  expect(shape(themeById("hologram") as Theme)).toEqual(shape(THEMES[0] as Theme));
});

it("the four themes > keeps the sober themes free of glow, grid and bloom", () => {
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

it("the four themes > caps the Hologram glow and uses a monospace font and a ground grid", () => {
  const hologram = themeById("hologram") as Theme;
  expect(hologram.effects?.glow).toBeLessThanOrEqual(0.6);
  expect(hologram.effects?.grid).toBe(true);
  expect(hologram.font).toContain("monospace");
  expect(luminance(hex(hologram, "background"))).toBeLessThan(0.02);
});

for (const theme of THEMES) {
  it(`${theme.label}: text is readable on its panel`, () => {
    expect(contrastRatio(hex(theme, "text"), hex(theme, "panel"))).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(hex(theme, "textMuted"), hex(theme, "panel"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex(theme, "accentText"), hex(theme, "accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex(theme, "accent"), hex(theme, "panel"))).toBeGreaterThanOrEqual(4.5);
  });

  it(`${theme.label}: every text color the style sheet uses passes WCAG AA where it is drawn, small text included`, () => {
    // muted text also sits on the bare stage (district names, the chip) and on a panel
    expect(contrastRatio(hex(theme, "textMuted"), hex(theme, "background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex(theme, "text"), hex(theme, "background"))).toBeGreaterThanOrEqual(4.5);
    // warnings: the red as text, and the panel color as text on a red disc
    expect(contrastRatio(hex(theme, "riskVeryHigh"), hex(theme, "panel"))).toBeGreaterThanOrEqual(4.5);
    // the focus ring and the borders of controls are non-text: 3:1 against what they sit on
    expect(contrastRatio(hex(theme, "accent"), hex(theme, "background"))).toBeGreaterThanOrEqual(3);
  });

  it(`${theme.label}: the edge of a control stands out from its panel by 3:1`, () => {
    // --control-edge is the muted text color mixed 75/25 into the panel color, in sRGB
    const muted = hex(theme, "textMuted");
    const panel = hex(theme, "panel");
    const edge = muted.map((c, i) => 0.75 * c + 0.25 * (panel[i] as number)) as unknown as typeof muted;
    expect(contrastRatio(edge, panel)).toBeGreaterThanOrEqual(3);
  });

  it(`${theme.label}: the sequential ramp gets steadily ${theme.mode === "dark" ? "lighter" : "darker"}, so it reads without hue`, () => {
    const l = theme.ramps.sequential.map((c) => luminance(parseHex(c)));
    const steady = l.every(
      (v, i) => i === 0 || (theme.mode === "dark" ? v > (l[i - 1] as number) : v < (l[i - 1] as number)),
    );
    expect(steady, `luminance of the stops: ${l.join(", ")}`).toBe(true);
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

it("contrast and color vision checks, on each theme's background > measures contrast and simulates color vision as expected", () => {
  expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
  expect(contrastRatio([1, 1, 1], [1, 1, 1])).toBe(1);
  // pure red and pure green come much closer for a deuteranope
  expect(distance([1, 0, 0], [0, 1, 0], "deuteranopia")).toBeLessThan(distance([1, 0, 0], [0, 1, 0]) * 0.6);
  expect(simulate([1, 1, 1], "protanopia").every((c) => Math.abs(c - 1) < 0.01)).toBe(true);
});
