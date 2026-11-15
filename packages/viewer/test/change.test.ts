import { computeLayout } from "@factory-city/layout";
import { describe, expect, it } from "vitest";
import { buildTimelineData, layoutWeights } from "../src/data/timeline";
import { presetStatuses } from "../src/presets/index";
import { DEFAULT_THEME } from "../src/themes/index";
import { biggestChanges, CHANGE, changePlacements, changePosition, frameChanges } from "../src/view/change";
import { legendLines } from "../src/view/legend";
import { FRAMES, MAPPING, snapshot } from "./timeline-helpers";

const data = buildTimelineData(FRAMES.map(snapshot));
const layout = computeLayout(layoutWeights(data, "rloc"));
const u = (path: string) => data.pathIndex.get(path) as number;
const mapping = { ...MAPPING, color: CHANGE };

describe("what a frame changed", () => {
  it("classifies every file as added, removed, grown, shrunk or unchanged", () => {
    const changes = frameChanges(data, 1, "rloc");
    const of = (p: string) => changes[u(p)];
    expect(of("src/new.ts")).toMatchObject({ status: "added", delta: 40 });
    expect(of("src/a.ts")).toMatchObject({ status: "grown", delta: 80 });
    expect(of("src/b.ts")).toMatchObject({ status: "unchanged", delta: 0 });
    expect(frameChanges(data, 2, "rloc")[u("src/b.ts")]).toMatchObject({ status: "removed", delta: -50 });
    expect(frameChanges(data, 2, "rloc")[u("src/a.ts")]).toMatchObject({ status: "shrunk", delta: -120 });
    // a file that exists in neither frame is not a change
    expect(frameChanges(data, 1, "rloc")[u("lib/deep/y.ts")]?.status).toBe("unchanged");
  });

  it("changes nothing in the first frame", () => {
    expect(frameChanges(data, 0, "rloc").every((c) => c.status === "unchanged")).toBe(true);
  });

  it("places changes on the diverging ramp, with added and removed at the ends", () => {
    expect(changePosition({ union: 0, status: "added", delta: 5 }, 100)).toBe(1);
    expect(changePosition({ union: 0, status: "removed", delta: -5 }, 100)).toBe(0);
    expect(changePosition({ union: 0, status: "unchanged", delta: 0 }, 100)).toBe(0.5);
    const big = changePosition({ union: 0, status: "grown", delta: 100 }, 100);
    const small = changePosition({ union: 0, status: "grown", delta: 10 }, 100);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0.5);
    expect(big).toBeLessThan(1);
    expect(changePosition({ union: 0, status: "shrunk", delta: -100 }, 100)).toBeCloseTo(1 - big, 10);
  });

  it("lists the largest changes first", () => {
    const top = biggestChanges(frameChanges(data, 2, "rloc"), 2).map((c) => data.paths[c.union]);
    expect(top).toEqual(["src/a.ts", "lib/x.ts"]);
  });
});

describe("Change preset", () => {
  it("still draws a removed file, at the size it had", () => {
    const { placements } = changePlacements(data, 2, layout, mapping, DEFAULT_THEME);
    const removed = placements[u("src/b.ts")];
    expect(removed).toBeDefined();
    expect(removed?.h).toBeGreaterThan(0);
    // a file that is absent from both frames stays an empty lot
    expect(placements[u("lib/deep/y.ts")]).toBeUndefined();
  });

  it("colors added and removed files with the two ends of the diverging ramp", () => {
    const added = changePlacements(data, 1, layout, mapping, DEFAULT_THEME).placements[u("src/new.ts")];
    const removed = changePlacements(data, 2, layout, mapping, DEFAULT_THEME).placements[u("src/b.ts")];
    // the theme's diverging ramp runs from red to blue
    expect((added?.color[2] ?? 0) > (added?.color[0] ?? 1)).toBe(true);
    expect((removed?.color[0] ?? 0) > (removed?.color[2] ?? 1)).toBe(true);
    expect(added?.ramp).toBeUndefined();
  });

  it("counts each kind of change in the legend", () => {
    const { legend } = changePlacements(data, 1, layout, mapping, DEFAULT_THEME);
    expect(legend.categories?.map((c) => `${c.label} ${c.count}`)).toEqual([
      "added 1",
      "grown 1",
      "unchanged 3",
      "shrunk 0",
      "removed 0",
    ]);
  });

  it("is offered for a timeline and not for a single snapshot", () => {
    const last = data.frames.at(-1)?.model;
    expect(presetStatuses(last as never).find((s) => s.preset.id === "change")?.available).toBe(true);
    const one = buildTimelineData([snapshot(FRAMES[0] as never)]).frames[0]?.model;
    expect(presetStatuses(one as never).find((s) => s.preset.id === "change")?.available).toBe(false);
  });

  it("explains the colors in plain language", () => {
    const text = legendLines(data.frames[1]?.model as never, mapping).map((l) => l.text);
    expect(text.at(-1)).toContain("blue = added or grown, red = removed or shrunk");
  });
});
