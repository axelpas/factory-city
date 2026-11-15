import { describe, expect, it } from "vitest";
import { presetStatuses } from "../src/presets/index";
import { lensGroups } from "../src/ui/lens";
import { makeModel, SAMPLE } from "./helpers";

describe("preset picker", () => {
  const groups = lensGroups(presetStatuses(makeModel(SAMPLE)), 0);
  const find = (id: string) => groups.flatMap((g) => g.items).find((i) => i.id === id);

  it("groups the presets: Code, History, Factory, Compare", () => {
    expect(groups.map((g) => g.name)).toEqual(["Code", "History", "Factory", "Compare"]);
    expect(groups[0]?.items.map((i) => i.id)).toContain("structure");
  });

  it("shows every preset with the question it answers", () => {
    for (const item of groups.flatMap((g) => g.items)) expect(item.question, item.id).toMatch(/\?$/);
    expect(find("structure")).toMatchObject({ available: true });
    expect(find("structure")?.needs).toBeUndefined();
  });

  it("says what an unavailable preset needs, in terms of data rather than metric names", () => {
    expect(find("hotspots")).toMatchObject({ available: false, needs: "Needs git history." });
    expect(find("cost")).toMatchObject({ available: false, needs: "Needs a facts file." });
    expect(find("duplication")?.needs).toContain("--with duplication");
  });

  it("falls back to the reason when the data level is there but the metric is not", () => {
    // level 1 data, yet no history metric in this model: the level is not what is missing
    const atLevelOne = lensGroups(presetStatuses(makeModel(SAMPLE)), 1);
    const hotspots = atLevelOne.flatMap((g) => g.items).find((i) => i.id === "hotspots");
    expect(hotspots?.needs).toContain("recent_commits");
  });
});
