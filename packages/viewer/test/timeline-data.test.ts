import type { Frame, TimelineManifest } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { syntheticSnapshots } from "../src/data/synthetic";
import { buildTimelineData, layoutWeights } from "../src/data/timeline";
import { createFormat } from "../src/lib/format";
import { frameChangeRows, lastChangeRow, lotCard } from "../src/view/card";
import { FRAMES, MAPPING, snapshot } from "./timeline-helpers";

const fmt = createFormat(["en-US"]);

function frame(index: number, patch: Partial<Frame> = {}): Frame {
  return {
    id: `f${index}`,
    index,
    kind: "feature",
    label: `c${index} step ${index}`,
    date: `2026-01-0${index + 1}T10:00:00.000Z`,
    commit: `c${index}`,
    subject: `step ${index}`,
    commits: [`c${index}`],
    snapshot: `frames.commit/f${index}.cc.json`,
    totals: { files: 0, rloc: 0, mcc: 0 },
    added: [],
    modified: [],
    deleted: [],
    metrics: { files_touched: 0, lines_added: 0, lines_deleted: 0, folders_touched: 0 },
    lines: {},
    ...patch,
  };
}

const manifest: TimelineManifest = {
  kind: "timeline",
  schemaVersion: 1,
  analyzerVersion: "test",
  createdAt: "2026-01-10T00:00:00.000Z",
  project: "demo",
  source: { mode: "commit", branch: "main", firstParent: true },
  dataLevel: 1,
  git: { available: true, shallow: false },
  metrics: [],
  categories: { language: ["typescript"] },
  ignored: { files: {}, folders: {}, warnings: {} },
  warnings: [],
  frames: [
    frame(0),
    frame(1, {
      added: ["src/new.ts"],
      modified: ["src/a.ts"],
      lines: { "src/a.ts": [90, 10], "src/new.ts": [40, 0] },
    }),
    frame(2, { deleted: ["src/b.ts"] }),
    frame(3),
    frame(4),
  ],
};
const data = buildTimelineData(FRAMES.map(snapshot), manifest);
const u = (path: string) => data.pathIndex.get(path) as number;

describe("timeline data", () => {
  it("indexes every file of any frame once, and maps each frame to it", () => {
    expect(data.paths).toHaveLength(5);
    expect(data.frames).toHaveLength(5);
    expect(data.frames[0]?.modelIndex[u("src/new.ts")]).toBe(-1);
    expect(data.frames[1]?.modelIndex[u("src/new.ts")]).toBeGreaterThanOrEqual(0);
    expect(data.frames[2]?.info?.deleted).toEqual(["src/b.ts"]);
    expect(data.project).toBe("demo");
  });

  it("computes statistics over all frames, so scales stay fixed", () => {
    const stats = data.frames[0]?.model.stats.get("mcc");
    expect(stats?.max).toBe(40); // reached in the last frame only
    expect(data.frames[4]?.model.stats.get("mcc")).toBe(stats);
    expect(data.frames[0]?.model.stats.has("nope")).toBe(false);
    expect(data.frames[0]?.model.stats.get("nope")).toBeUndefined();
  });

  it("weights each parcel by the file's largest value over time", () => {
    const weights = new Map(layoutWeights(data, MAPPING.area).map((w) => [w.path, w.weight]));
    expect(weights.get("src/a.ts")).toBe(200);
    expect(weights.get("lib/x.ts")).toBe(90);
    expect(weights.get("src/new.ts")).toBe(45);
  });

  it("treats a single snapshot as a timeline of one frame", () => {
    const one = buildTimelineData([snapshot(FRAMES[0] as never)]);
    expect(one.frames).toHaveLength(1);
    expect(one.frames[0]?.info).toBeUndefined();
    expect(frameChangeRows(one, 0, 0, MAPPING, fmt)).toEqual([]);
  });
});

describe("what a frame did to a file", () => {
  it("shows the change of the mapped values, the lines and the first appearance", () => {
    const rows = frameChangeRows(data, 1, u("src/a.ts"), MAPPING, fmt);
    expect(rows).toEqual([
      { label: "Real lines, this frame", value: "+80" },
      { label: "Complexity, this frame", value: "+20" },
      { label: "Deepest nesting, this frame", value: "+3" },
      { label: "Lines, this frame", value: "+90 −10" },
      { label: "Appeared at", value: "frame 1 (c0 step 0)" },
    ]);
  });

  it("shows a decrease with a minus sign", () => {
    const rows = frameChangeRows(data, 2, u("src/a.ts"), MAPPING, fmt);
    expect(rows[0]).toEqual({ label: "Real lines, this frame", value: "−120" });
  });

  it("says when the frame added the file", () => {
    const rows = frameChangeRows(data, 1, u("src/new.ts"), MAPPING, fmt);
    expect(rows[0]).toEqual({ label: "This frame", value: "added the file" });
    expect(rows.at(-1)).toEqual({ label: "Appeared at", value: "frame 2 (c1 step 1)" });
  });

  it("shows only the first appearance when nothing changed", () => {
    expect(frameChangeRows(data, 3, u("src/a.ts"), MAPPING, fmt)).toEqual([
      { label: "Appeared at", value: "frame 1 (c0 step 0)" },
    ]);
  });
});

describe("empty lot card", () => {
  it("says which file will stand there, and from which frame", () => {
    expect(lotCard(data, 0, u("src/new.ts"))).toEqual({
      kind: "lot",
      title: "new.ts",
      folder: "src",
      text: "This file will stand here from frame 2 (c1 step 1).",
    });
  });

  it("says which file stood there, and until which frame", () => {
    expect(lotCard(data, 4, u("lib/x.ts")).text).toBe("This file stood here until frame 4 (c3 step 3).");
  });

  it("says when a deleted file comes back", () => {
    expect(lotCard(data, 2, u("src/b.ts")).text).toBe(
      "This file stood here until frame 2 (c1 step 1) and comes back at frame 4 (c3 step 3).",
    );
  });
});

describe("synthetic city", () => {
  it("is deterministic and has the requested size", () => {
    const a = syntheticSnapshots(200, 3);
    const b = syntheticSnapshots(200, 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(3);
    expect(buildTimelineData(a).paths.length).toBeGreaterThan(150);
    expect(Object.keys(syntheticSnapshots(50, 1)[0]?.lenses.metrics.attributes ?? {})).toHaveLength(50);
  });
});

describe("last change of a file", () => {
  it("gives the date and the frame that last touched the file", () => {
    expect(lastChangeRow(data, 3, u("src/a.ts"), fmt)).toEqual({
      label: "Last change",
      value: "Jan 2, 2026 · c1 step 1",
    });
  });

  it("names the issue when the frame stands for one", () => {
    const withIssue = buildTimelineData(FRAMES.map(snapshot), {
      ...manifest,
      frames: manifest.frames.map((f) =>
        f.index === 1 ? { ...f, issue: { number: 12, title: "Export as CSV" } } : f,
      ),
    });
    expect(lastChangeRow(withIssue, 4, u("src/new.ts"), fmt)?.value).toBe("Jan 2, 2026 · #12 Export as CSV");
  });

  it("falls back to the days since the last change for a single snapshot, and to nothing without history", () => {
    const one = buildTimelineData([
      snapshot({ "a.ts": { rloc: 1, days_since_last_change: 3 }, "b.ts": { rloc: 1 } }),
    ]);
    expect(lastChangeRow(one, 0, 0, fmt)).toEqual({
      label: "Last change",
      value: "3 days before the snapshot",
    });
    expect(lastChangeRow(one, 0, 1, fmt)).toBeUndefined();
  });
});
