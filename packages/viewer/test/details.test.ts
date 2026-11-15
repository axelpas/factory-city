import { describe, expect, it } from "vitest";
import { statsOf } from "../src/data/model";
import { createFormat } from "../src/lib/format";
import { defaultMapping } from "../src/presets/index";
import { placeCard } from "../src/view/card-place";
import { fileDetails, risksOf, standing } from "../src/view/details";
import { languageLabel } from "../src/view/labels";
import { makeModel } from "./helpers";

const fmt = createFormat(["en-US"]);
const base = { rloc: 100, loc: 120, mcc: 12, max_nesting_level: 2, functions: 4 };
const model = makeModel(
  [
    {
      path: "src/big.ts",
      values: {
        ...base,
        rloc: 900,
        mcc: 80,
        imports_out: 6,
        imports_in: 1,
        escape_hatches: 0,
        escape_any: 0,
        escape_lint_disable: 0,
        number_of_commits: 9,
        language: 0,
      },
    },
    {
      path: "src/a.ts",
      values: {
        ...base,
        imports_out: 1,
        imports_in: 0,
        escape_hatches: 2,
        escape_any: 2,
        escape_lint_disable: 0,
        number_of_commits: 3,
        language: 0,
      },
    },
    {
      path: "src/b.ts",
      values: {
        ...base,
        rloc: 40,
        mcc: 3,
        escape_hatches: 0,
        escape_any: 0,
        escape_lint_disable: 0,
        number_of_commits: 1,
        language: 0,
      },
    },
    {
      path: "src/c.test.ts",
      values: { ...base, rloc: 10, mcc: 1, number_of_commits: 1, is_test: 1, language: 0 },
    },
  ],
  { categories: { language: ["typescript"], is_test: ["no", "yes"] } },
);
const { mapping } = defaultMapping(model);
const details = (path: string) => fileDetails(model, model.filesByPath.get(path) as number, mapping, fmt);

describe("file details", () => {
  const d = details("src/big.ts");

  it("starts with the mapped channels, then the metrics by family", () => {
    expect(d.channels.map((c) => c.label)).toEqual([
      "Area: Real lines",
      "Height: Complexity",
      "Color: Modules imported",
    ]);
    expect(d.groups.map((g) => g.name)).toEqual([
      "Size",
      "Complexity",
      "Coupling and cohesion",
      "Shortcuts",
      "History",
    ]);
    expect(d.groups[0]?.rows.map((r) => r.id)).toEqual(["loc", "rloc", "functions"]);
  });

  it("names the language and says when the file is a test", () => {
    expect(d).toMatchObject({ title: "big.ts", path: "src/big.ts", language: "TypeScript", isTest: false });
    expect(details("src/c.test.ts").isTest).toBe(true);
    expect(languageLabel("csharp")).toBe("C#");
    expect(languageLabel("zig")).toBe("Zig");
  });

  it("folds a family whose values are all zero into one line", () => {
    const shortcuts = d.groups.find((g) => g.name === "Shortcuts");
    expect(shortcuts).toMatchObject({ allZero: true, zeroText: "No silenced check." });
    expect(shortcuts?.rows.length).toBe(3);
    expect(details("src/a.ts").groups.find((g) => g.name === "Shortcuts")?.allZero).toBe(false);
  });

  it("lists the metrics a file has no value for apart, with the reason, never as zero", () => {
    const test = details("src/c.test.ts");
    expect(test.unavailable.map((u) => u.label)).toEqual(
      expect.arrayContaining(["Modules imported", "Silenced checks"]),
    );
    expect(test.unavailable.every((u) => u.note.length > 0)).toBe(true);
    expect(test.groups.flatMap((g) => g.rows).map((r) => r.id)).not.toContain("imports_out");
  });

  it("shows where a value stands only when it tells something: ties are not counted as higher", () => {
    const rows = d.groups.flatMap((g) => g.rows);
    // the largest of four files: three are strictly below
    expect(rows.find((r) => r.id === "rloc")?.rank).toBe(0.75);
    // every file has four functions: no rank at all
    expect(rows.find((r) => r.id === "functions")?.rank).toBeUndefined();
    const stats = statsOf([0, 0, 0, 5]);
    expect(standing(stats, 0)).toEqual({ below: 0, same: 0.75 });
    expect(standing(stats, 5)).toEqual({ below: 0.75, same: 0.25 });
  });

  it("names the risk levels exceeded, worst first", () => {
    const dimensions = [
      { label: "File size", metric: "rloc", bounds: [200, 400, 750] },
      { label: "Complexity", metric: "mcc", bounds: [10, 20, 100] },
      { label: "Nesting", metric: "max_nesting_level", bounds: [3, 4, 6] },
    ];
    const big = model.files[model.filesByPath.get("src/big.ts") as number];
    expect(risksOf(model, big?.values ?? {}, dimensions, fmt)).toEqual([
      "File size: very high (900)",
      "Complexity: high (80)",
    ]);
  });
});

describe("hover card placement", () => {
  const free = { x: 300, y: 70, w: 800, h: 500 };
  const card = { w: 280, h: 200 };
  const inside = (p: { left: number; top: number }) =>
    p.left >= free.x &&
    p.top >= free.y &&
    p.left + card.w <= free.x + free.w &&
    p.top + card.h <= free.y + free.h;

  it("sits beside the pointer when there is room", () => {
    expect(placeCard({ x: 400, y: 200 }, card, free)).toEqual({ left: 418, top: 218 });
  });

  it("flips to the other side near the right and bottom edges", () => {
    const p = placeCard({ x: 1050, y: 540 }, card, free);
    expect(p.left).toBeLessThan(1050 - card.w);
    expect(p.top).toBeLessThan(540 - card.h);
  });

  it("never leaves the free area: not over the bar, the panels or the timeline", () => {
    for (const pointer of [
      { x: 310, y: 75 },
      { x: 1095, y: 75 },
      { x: 310, y: 565 },
      { x: 1095, y: 565 },
      { x: 700, y: 80 },
    ])
      expect(inside(placeCard(pointer, card, free)), JSON.stringify(pointer)).toBe(true);
  });
});
