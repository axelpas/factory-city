import type { Report } from "@factory-city/schema";
import { expect, it } from "vitest";
import { buildTimelineData } from "../src/data/timeline";
import { createFormat } from "../src/lib/format";
import { presetStatuses } from "../src/presets/index";
import { healthView } from "../src/view/health";
import { FRAMES, snapshot } from "./timeline-helpers";

const fmt = createFormat(["en-US"]);
const share = { low: 0.5, moderate: 0, high: 0.5, veryHigh: 0, rated: 1 };

function reportWith(profile: Report["health"]["profile"]): Report {
  return {
    kind: "report",
    schemaVersion: 1,
    analyzerVersion: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    project: "demo",
    dataLevel: 0,
    health: { score: 50, scoreWithoutSecurity: 100, profile, scored: Object.keys(profile) },
    dimensions: [
      {
        id: "size",
        label: "File size",
        metric: "rloc",
        kind: "static",
        bounds: [200, 400, 750],
        source: "default",
      },
      {
        id: "security",
        label: "Security signals",
        metric: "security_signals",
        kind: "static",
        bounds: [0, 1, 3],
        source: "default",
      },
    ],
    hotspots: [],
    hiddenLinks: [],
    notice: "",
  } as unknown as Report;
}

it("security in the Health tab > shows the score without security when security was rated", () => {
  const data = buildTimelineData([snapshot(FRAMES[0] ?? {})]);
  const view = healthView(data, 0, reportWith({ size: share, security: share }), fmt);
  expect(view.scoreText).toBe("50.0%");
  expect(view.scoreWithoutSecurityText).toBe("100.0%");
});

it("security in the Health tab > says nothing about it when the code could not be rated on security", () => {
  const data = buildTimelineData([snapshot(FRAMES[0] ?? {})]);
  const view = healthView(data, 0, reportWith({ size: share }), fmt);
  expect(view.scoreWithoutSecurityText).toBeUndefined();
});

it("security preset > is offered when the files carry security signals, colored by them", () => {
  const frame = {
    "src/a.ts": { rloc: 100, mcc: 10, security_signals: 2 },
    "src/b.ts": { rloc: 50, mcc: 5, security_signals: 0 },
  };
  const model = buildTimelineData([snapshot(frame as never)]).frames[0]?.model;
  if (!model) throw new Error("no model");
  const status = presetStatuses(model).find((s) => s.preset.id === "security");
  expect(status?.available).toBe(true);
  expect(status?.mapping?.color).toBe("security_signals");
});

it("security preset > is not offered without any security metric", () => {
  const model = buildTimelineData([snapshot(FRAMES[0] ?? {})]).frames[0]?.model;
  if (!model) throw new Error("no model");
  expect(presetStatuses(model).find((s) => s.preset.id === "security")?.available).toBe(false);
});

it("risky and moving preset > needs history, colors by security signals and marks the files that change often", () => {
  const file = { rloc: 100, mcc: 10, security_signals: 2, recent_commits: 6 };
  const frame = {
    "src/a.ts": file,
    "src/b.ts": { rloc: 50, mcc: 5, security_signals: 0, recent_commits: 1 },
  };
  const model = buildTimelineData([snapshot(frame as never)]).frames[0]?.model;
  if (!model) throw new Error("no model");
  const status = presetStatuses(model).find((s) => s.preset.id === "risky-and-moving");
  expect(status?.available).toBe(true);
  expect(status?.mapping).toMatchObject({ color: "security_signals", marker: { metric: "recent_commits" } });
  const noHistory = buildTimelineData([
    snapshot({ "src/a.ts": { rloc: 100, mcc: 10, security_signals: 2 } } as never),
  ]).frames[0]?.model;
  if (!noHistory) throw new Error("no model");
  expect(presetStatuses(noHistory).find((s) => s.preset.id === "risky-and-moving")?.available).toBe(false);
});
