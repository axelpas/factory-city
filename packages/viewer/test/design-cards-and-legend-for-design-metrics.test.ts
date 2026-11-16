import { describe, expect, it } from "vitest";
import { defaultMapping } from "../src/presets/index";
import { fileCard, folderCard } from "../src/view/card";
import { fileDetails } from "../src/view/details";
import { legendLines } from "../src/view/legend";
import { FILES, fmt, model } from "./design-helpers";
import { makeModel } from "./helpers";

describe("cards and legend for design metrics", () => {
  const { mapping } = defaultMapping(model);
  const m = {
    ...mapping,
    color: "imports_out",
    marker: { metric: "cohesion_groups", threshold: 2, peak: 6, source: "risk" as const },
  };

  it("shows the marker channel and the coupling on the file card", () => {
    const card = fileCard(model, model.filesByPath.get("core/a.ts") as number, m, fmt);
    expect(card.channels.map((c) => c.label)).toContain("Marker: Cohesion groups");
    // the other metrics are no longer on the card: they are in the details
    const details = fileDetails(model, model.filesByPath.get("core/a.ts") as number, mapping, fmt);
    const coupling = details.groups.find((g) => g.name === "Coupling and cohesion");
    expect(coupling?.rows.map((r) => r.label)).toEqual(
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

  it("explains the marker and the tint in plain language", () => {
    const text = legendLines(model, { ...m, tint: "folder_cohesion" }).map((l) => l.text);
    expect(text).toContain("pyramid roof, steeper as it grows = above 2 (high risk) · 1 file");
    expect(text).toContain("darker ground = more self-contained");
  });
});
