import { describe, expect, it } from "vitest";
import { createFormat } from "../src/lib/format";
import { defaultMapping } from "../src/presets/index";
import { fileCard, folderCard } from "../src/view/card";
import { legendLines } from "../src/view/legend";
import { makeModel, SAMPLE } from "./helpers";

const fmt = createFormat(["en-US"]);
const model = makeModel(SAMPLE, {
  categories: { language: ["typescript", "tsx"], is_test: ["no", "yes"] },
  ignored: { files: { not_source_code: 12 }, folders: { dependency_or_build_folder: 1 }, warnings: {} },
});
const { mapping } = defaultMapping(model);

describe("file card", () => {
  const card = fileCard(model, model.filesByPath.get("src/a.ts") as number, mapping, fmt);

  it("shows name, folder, language and test flag", () => {
    expect(card.title).toBe("a.ts");
    expect(card.folder).toBe("src");
    expect(card.language).toBe("TypeScript");
    expect(card.isTest).toBe(false);
  });

  it("shows each mapped channel with its value, unit and place in the city", () => {
    const labels = card.channels.map((c) => c.label);
    expect(labels).toEqual(["Area: Real lines", "Height: Complexity", "Color: Deepest nesting"]);
    expect(card.channels[0]).toMatchObject({ value: "100 lines" });
    expect(card.channels[0]?.marker).toBeGreaterThan(0.5);
  });

  it("is a glance: the mapped channels and at most two facts that stand out", () => {
    expect(card.facts).toEqual([]);
    const dimensions = [
      { label: "Complexity", metric: "mcc", bounds: [5, 10, 20] },
      { label: "File size", metric: "rloc", bounds: [20, 50, 500] },
      { label: "Nesting", metric: "max_nesting_level", bounds: [0, 1, 2] },
    ];
    const risky = fileCard(model, model.filesByPath.get("src/a.ts") as number, mapping, fmt, dimensions);
    expect(risky.facts.length).toBeLessThanOrEqual(2);
    // the worst level first
    expect(risky.facts[0]).toEqual({ label: "Complexity", value: "very high (30)" });
  });

  it("writes units in agreement with the number", () => {
    expect(fmt.quantity(1, "modules")).toBe("1 module");
    expect(fmt.quantity(6, "modules")).toBe("6 modules");
    expect(fmt.quantity(0, "places")).toBe("0 places");
    expect(fmt.quantity(0.25, "share")).toBe("25%");
    expect(fmt.quantity(28, "")).toBe("28");
    expect(fmt.quantity(1, "per 1,000 lines")).toBe("1 per 1,000 lines");
  });

  it("offers the details on click", () => {
    expect(card.hint).toBe("Click for all its metrics");
  });
});

describe("folder card", () => {
  it("shows the number of files, real lines and the worst files", () => {
    const c = folderCard(model, "src", fmt);
    expect(c.rows).toEqual(
      expect.arrayContaining([
        { label: "Files", value: "4" },
        { label: "Real lines", value: "183" },
      ]),
    );
    expect(c.worst[0]).toEqual({ path: "src/a.ts", value: "30" });
  });

  it("names the root folder", () => {
    expect(folderCard(model, "", fmt).title).toBe("(root)");
  });
});

describe("legend and help lines", () => {
  it("reads in plain language", () => {
    const lines = legendLines(model, mapping).map((l) => l.text);
    expect(lines).toEqual(["bigger ground = more code", "taller = more complex", "darker = deeper nesting"]);
  });
});
