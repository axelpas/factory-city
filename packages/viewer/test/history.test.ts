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
