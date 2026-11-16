import type { Frame, Report, TimelineManifest } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { buildTimelineData } from "../src/data/timeline";
import { createFormat } from "../src/lib/format";
import { healthView, scoreAt, trendPoints } from "../src/view/health";
import { FRAMES, snapshot } from "./timeline-helpers";

const fmt = createFormat(["en-US"]);
const share = (low: number, high: number, rated = 1) => ({ low, moderate: 0, high, veryHigh: 0, rated });

const report: Report = {
  kind: "report",
  schemaVersion: 1,
  analyzerVersion: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  project: "demo",
  dataLevel: 1,
  health: {
    score: 62.5,
    profile: { size: share(0.9, 0.1), complexity: share(0.7, 0.3, 0.8) },
    scored: ["size", "complexity"],
  },
  dimensions: [
    {
      id: "size",
      label: "File size",
      metric: "rloc",
      kind: "static",
      bounds: [200, 400, 750],
      source: "project default, not a standard",
    },
    {
      id: "complexity",
      label: "Complexity",
      metric: "max_function_complexity",
      kind: "static",
      bounds: [10, 20, 50],
      source: "McCabe",
    },
    {
      id: "cohesion",
      label: "Cohesion",
      metric: "cohesion_groups",
      kind: "static",
      bounds: [1, 2, 4],
      minRloc: 100,
      source: "LCOM4",
    },
  ],
  hotspots: [
    {
      path: "src/a.ts",
      rank: 1,
      basis: "complexity-and-change",
      metrics: { mcc: 40 },
      exceeded: [],
      actions: [{ type: "extract-functions", text: "Extract functions." }],
      size: "M",
    },
  ],
  hiddenLinks: [{ kind: "co-change-without-import", files: ["a", "b"], detail: "x" }],
  notice: "The score is a heuristic.",
};

function manifest(scores: number[], hotspots: string[][]): TimelineManifest {
  const frames = scores.map(
    (score, index): Frame => ({
      id: `f${index}`,
      index,
      kind: "feature",
      label: `step ${index}`,
      date: "2026-01-01T00:00:00.000Z",
      commit: "c",
      subject: "s",
      commits: [],
      snapshot: "",
      totals: { files: 0, rloc: 0, mcc: 0 },
      added: [],
      modified: [],
      deleted: [],
      metrics: { files_touched: 0, lines_added: 0, lines_deleted: 0, folders_touched: 0 },
      lines: {},
      health: {
        score,
        profile: { size: share(1 - index / 10, index / 10) },
        hotspots: hotspots[index] ?? [],
      },
    }),
  );
  return {
    kind: "timeline",
    schemaVersion: 1,
    analyzerVersion: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    project: "demo",
    source: { mode: "commit", branch: "main", firstParent: true },
    dataLevel: 1,
    git: { available: true, shallow: false },
    metrics: [],
    categories: {},
    ignored: { files: {}, folders: {}, warnings: {} },
    warnings: [],
    frames,
  };
}

describe("health panel", () => {
  const one = buildTimelineData([snapshot(FRAMES[0] as never)]);

  it("shows the score with its notice, the profile and what could not be rated", () => {
    const view = healthView(one, 0, report, fmt);
    expect(view).toMatchObject({
      available: true,
      score: 62.5,
      scoreText: "62.5 out of 100",
      notice: "The score is a heuristic.",
      trend: [],
    });
    expect(view.profile.map((r) => `${r.label}: ${r.text}`)).toEqual([
      "File size: 10% high or very high",
      "Complexity: 30% high or very high, rated on 80% of the code",
    ]);
    expect(view.unavailable).toEqual(["Cohesion"]);
    expect(view.profile[0]?.thresholds).toBe(
      "Low up to 200, moderate up to 400, high up to 750. Source: project default, not a standard.",
    );
    expect(view.hotspots).toHaveLength(1);
    expect(view.hiddenLinks).toHaveLength(1);
    expect(view.movement).toBeUndefined();
  });

  it("says what to do when there is no report", () => {
    const view = healthView(one, 0, undefined, fmt);
    expect(view.available).toBe(false);
    expect(view.reason).toContain("factory-city analyze");
  });

  it("follows the frame under the playhead: score, profile, trend and movement", () => {
    const data = buildTimelineData(
      FRAMES.map(snapshot),
      manifest(
        [100, 80, 80, 90, 62.5],
        [[], ["src/a.ts"], ["src/a.ts", "lib/x.ts"], ["lib/x.ts"], ["src/a.ts"]],
      ),
    );
    const second = healthView(data, 1, report, fmt);
    expect(second.score).toBe(80);
    expect(second.trend).toEqual([100, 80, 80, 90, 62.5]);
    expect(second.movement).toEqual({ qualityDelta: "−20", created: ["src/a.ts"], resolved: [] });
    expect(second.profile[0]?.share.high).toBeCloseTo(0.1, 10);
    // hotspot details belong to the latest frame only
    expect(second.hotspots).toEqual([]);
    expect(second.hotspotPaths).toEqual(["src/a.ts"]);
    expect(second.hotspotsFromLatest).toBe(true);
    const fourth = healthView(data, 3, report, fmt);
    expect(fourth.movement).toEqual({ qualityDelta: "+10", created: [], resolved: ["src/a.ts"] });
    expect(healthView(data, 2, report, fmt).movement?.qualityDelta).toBe("unchanged");
    const last = healthView(data, 4, report, fmt);
    expect(last.hotspots).toHaveLength(1);
    expect(last.hotspotsFromLatest).toBe(false);
  });

  it("draws the trend, skipping frames without a score", () => {
    expect(trendPoints([0, 50, 100], 100, 10)).toBe("0.0,10.0 50.0,5.0 100.0,0.0");
    expect(trendPoints([10, Number.NaN, 20], 100, 10)).toBe("0.0,10.0 100.0,0.0");
    expect(trendPoints([5], 100, 10)).toBe("");
    expect(trendPoints([7, 7], 100, 10)).toBe("0.0,10.0 100.0,10.0");
  });
});

describe("score at the playhead", () => {
  const three = () =>
    buildTimelineData(
      FRAMES.slice(0, 3).map((f) => snapshot(f as never)),
      manifest([80, 60, 70], [[], [], []]),
    );

  it("is the score of a frame on that frame, and moves between two frames with the playhead", () => {
    const data = three();
    expect(scoreAt(data, report, 0)).toBe(80);
    expect(scoreAt(data, report, 1)).toBe(60);
    expect(scoreAt(data, report, 0.5)).toBe(70);
    expect(scoreAt(data, report, 1.25)).toBeCloseTo(62.5, 10);
    expect(scoreAt(data, report, 2)).toBe(70);
  });

  it("stays inside the timeline, and without a report there is no score", () => {
    const data = three();
    expect(scoreAt(data, report, -3)).toBe(80);
    expect(scoreAt(data, report, 50)).toBe(70);
    expect(scoreAt(data, undefined, 1)).toBeUndefined();
  });

  it("is the reported score for a single snapshot", () => {
    expect(scoreAt(buildTimelineData([snapshot(FRAMES[0] as never)]), report, 0)).toBe(62.5);
  });
});
