import { describe, expect, it } from "vitest";
import { createFormat } from "../src/lib/format";
import { defaultMapping } from "../src/presets/index";
import { fileCard, folderCard } from "../src/view/card";
import { dataLevelLine, hiddenContentLine, legendLines } from "../src/view/legend";
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
    expect(card.language).toBe("typescript");
    expect(card.isTest).toBe(false);
  });

  it("shows each mapped channel with its value, unit and place in the city", () => {
    const labels = card.channels.map((c) => c.label);
    expect(labels).toEqual(["Ground area: Real lines", "Height: Complexity", "Color: Deepest nesting"]);
    expect(card.channels[0]).toMatchObject({ value: "100 lines" });
    expect(card.channels[0]?.marker).toBeGreaterThan(0.5);
  });

  it("lists other key metrics but not the ones already mapped", () => {
    const labels = card.metrics.map((m) => m.label);
    expect(labels).toContain("Functions");
    expect(labels).not.toContain("Real lines");
  });

  it("shows n/a with a reason for a value the file does not have", () => {
    const c = fileCard(model, model.filesByPath.get("src/const.ts") as number, mapping, fmt);
    const row = c.metrics.find((m) => m.label === "Worst function complexity");
    expect(row).toMatchObject({ value: "n/a" });
    expect(row?.note).toBeTruthy();
  });

  it("offers the details on click", () => {
    expect(card.hint).toBe("Click for details");
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

  it("explains hidden content and how to show it", () => {
    expect(hiddenContentLine(model, fmt.integer)).toBe(
      "12 files and 1 folder left out: assets, dependencies, generated or non-code files. Analyze with --all to show everything.",
    );
  });

  it("states the data level and the next step", () => {
    expect(dataLevelLine(model)).toContain("Data level 0");
    expect(dataLevelLine(model)).toContain("Analyze a git repository");
  });
});
