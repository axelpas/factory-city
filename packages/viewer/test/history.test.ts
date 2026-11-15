import { describe, expect, it } from "vitest";
import { defaultMapping, presetStatuses } from "../src/presets/index";
import { dataLevelLine } from "../src/view/legend";
import { makeModel, SAMPLE } from "./helpers";

const withHistory = makeModel(
  SAMPLE.map((s, i) => ({ ...s, values: { ...s.values, recent_commits: i, fix_commits: i % 2 } })),
  { dataLevel: 1, git: { available: true, shallow: false } },
);

describe("history presets", () => {
  it("defaults to Hotspots when the snapshot has git history", () => {
    const { preset, mapping } = defaultMapping(withHistory);
    expect(preset.id).toBe("hotspots");
    expect(mapping).toMatchObject({ area: "rloc", height: "mcc", color: "recent_commits" });
  });

  it("defaults to Structure without history and lists the history presets as unavailable with a reason", () => {
    const plain = makeModel(SAMPLE);
    expect(defaultMapping(plain).preset.id).toBe("structure");
    const hotspots = presetStatuses(plain).find((s) => s.preset.id === "hotspots");
    expect(hotspots?.available).toBe(false);
    expect(hotspots?.reason).toContain("recent_commits");
  });

  it("offers Bug magnets colored by fix commits", () => {
    const status = presetStatuses(withHistory).find((s) => s.preset.id === "bug-magnets");
    expect(status?.mapping?.color).toBe("fix_commits");
  });

  it("states level 1 and the action that unlocks level 2", () => {
    expect(dataLevelLine(withHistory)).toContain("Data level 1 (history)");
    expect(dataLevelLine(withHistory)).toContain("gh");
  });
});

describe("provenance presets", () => {
  const model = makeModel(
    SAMPLE.map((s, i) => ({
      ...s,
      values: {
        ...s.values,
        rework_ratio: i / 10,
        issues_recent: i,
        main_agent: i % 2,
        main_agent_share: 0.8,
      },
    })),
    { dataLevel: 1, categories: { main_agent: ["Agent One", "unknown"] } },
  );

  it("offers Waste, Contention and Agents with their questions", () => {
    const byId = new Map(presetStatuses(model).map((s) => [s.preset.id, s]));
    expect(byId.get("waste")?.mapping?.color).toBe("rework_ratio");
    expect(byId.get("contention")?.mapping?.color).toBe("issues_recent");
    expect(byId.get("agents")?.mapping?.color).toBe("main_agent");
    expect(byId.get("agents")?.preset.question).toBe("Who wrote what?");
    expect(byId.get("agents")?.preset.group).toBe("Factory");
  });

  it("lists them as unavailable without provenance", () => {
    const plain = makeModel(SAMPLE);
    for (const id of ["waste", "contention", "agents"]) {
      expect(presetStatuses(plain).find((s) => s.preset.id === id)?.available).toBe(false);
    }
  });

  it("names the main author on the card", async () => {
    const { fileCard } = await import("../src/view/card");
    const { createFormat } = await import("../src/lib/format");
    const { mapping } = defaultMapping(model);
    const card = fileCard(
      model,
      model.filesByPath.get("src/b.ts") as number,
      mapping,
      createFormat(["en-US"]),
    );
    expect(card.facts).toContainEqual(expect.objectContaining({ label: "Main author", value: "unknown" }));
  });
});
