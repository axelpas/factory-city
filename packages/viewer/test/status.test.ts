import { describe, expect, it } from "vitest";
import { createFormat } from "../src/lib/format";
import { statusChip, statusDetails, statusWarnings } from "../src/view/status";
import { makeModel, SAMPLE } from "./helpers";

const fmt = createFormat(["en-US"]);

describe("status chip", () => {
  const model = makeModel(SAMPLE, {
    ignored: { files: { not_source_code: 12 }, folders: { dependency_or_build_folder: 1 }, warnings: {} },
  });

  it("reads the data level in two words and the file count", () => {
    const chip = statusChip(model, fmt.integer);
    expect(chip.label).toBe("Level 0 · files");
    expect(chip.files).toBe(`${SAMPLE.length} files`);
    expect(chip.warning).toBe(false);
  });

  it("opens on what the level gives, what the next one needs and what was left out", () => {
    const d = statusDetails(model, fmt.integer);
    expect(d.gives).toContain("Level 0 (files)");
    expect(d.next).toContain("level 1");
    expect(d.leftOut).toEqual([
      { reason: "Not source code", count: "12" },
      { reason: "Dependency or build folder", count: "1" },
    ]);
    expect(d.hint).toContain("--all");
  });

  it("marks a shallow clone and lists the analyzer's warnings", () => {
    const shallow = makeModel(SAMPLE, {
      git: { available: true, shallow: true },
      warnings: ["2 files with syntax errors"],
    });
    expect(statusChip(shallow, fmt.integer).warning).toBe(true);
    expect(statusWarnings(shallow)).toEqual([
      expect.stringContaining("Shallow clone"),
      "2 files with syntax errors",
    ]);
    expect(statusDetails(shallow, fmt.integer).warnings).toHaveLength(2);
  });
});
