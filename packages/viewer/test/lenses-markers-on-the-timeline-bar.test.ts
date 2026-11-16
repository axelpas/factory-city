import { describe, expect, it } from "vitest";
import { presetStatuses } from "../src/presets/index";
import { factoryView, kpiText } from "../src/view/factory";
import { frameCardRows, frameMarkers, hiddenLensesLine, seriesStates } from "../src/view/lenses";
import { makeModel, SAMPLE } from "./helpers";
import { factory, fmt, frame } from "./lenses-helpers";

describe("markers on the timeline bar", () => {
  it("marks a failed first CI run, a scope gap and a lower score", () => {
    const f = frame(0, "fix", { first_pass_green: false, scope_gap: true, quality_delta: -1.5 });
    expect(frameMarkers(f).map((m) => m.type)).toEqual(["ci", "scope", "quality"]);
    expect(frameMarkers(f)[0]?.title).toBe("The first CI run failed");
  });

  it("marks nothing for a clean frame, an unknown one, or a missing one", () => {
    expect(
      frameMarkers(frame(0, "feature", { first_pass_green: true, scope_gap: false, quality_delta: 2 })),
    ).toEqual([]);
    expect(frameMarkers(frame(0, "feature"))).toEqual([]);
    expect(frameMarkers(undefined)).toEqual([]);
  });
});

describe("trend strip", () => {
  const frames = [
    frame(0, "feature", { cost: 2 }, { health: { score: 90, profile: {}, hotspots: [] } }),
    frame(1, "fix", { cost: 3, rework_after: 0.2 }, { health: { score: 80, profile: {}, hotspots: [] } }),
    frame(2, "feature", {}, { health: { score: 85, profile: {}, hotspots: [] } }),
  ];
  const states = seriesStates(frames);
  const of = (id: string) => states.find((s) => s.series.id === id);

  it("offers the series the data can draw", () => {
    expect(of("files")).toMatchObject({ available: true, values: [10, 11, 12] });
    expect(of("score")?.values).toEqual([90, 80, 85]);
    expect(of("cost")?.available).toBe(true);
    expect(of("cost")?.values[2]).toBeNaN();
  });

  it("follows the share of fixes so far", () => {
    expect(of("fixes")?.values).toEqual([0, 0.5, 1 / 3]);
  });

  it("hides a series with under two values, and says what would show it", () => {
    expect(of("ci")?.available).toBe(false);
    expect(of("rework")?.available).toBe(false);
    const line = hiddenLensesLine(states);
    expect(line).toContain("CI attempts (needs CI runs on pull requests (data level 2))");
    expect(line).toContain("Rework afterwards (needs git history, and 14 days of later history per frame)");
    expect(line).not.toContain("Cost");
  });

  it("says nothing when every series is available", () => {
    const full = frames.map((f) => ({
      ...f,
      metrics: { ...f.metrics, ci_attempts: 1, rework_after: 0.1, cost: 1 },
    }));
    expect(hiddenLensesLine(seriesStates(full))).toBeUndefined();
  });
});

describe("frame card on the bar", () => {
  it("shows kind, estimate against actual scope, score, agent and model, CI and cost when known", () => {
    const f = frame(1, "fix", {
      estimate: "S",
      scope_gap: true,
      quality_delta: -2.5,
      agent: "agent-a",
      model: "model-x",
      outcome: "succeeded",
      attempts: 2,
      ci_attempts: 3,
      cycle_time_hours: 26.5,
      cost: 4.2,
      currency: "CHF",
      rework_after: 0.25,
      caused_fixes: 1,
    });
    expect(frameCardRows(f, fmt).map((r) => `${r.label}: ${r.value}`)).toEqual([
      "Kind: fix",
      "Estimate S, actual scope: 3 files, 120 lines (well beyond)",
      "Score: −2.5",
      "Agent, model: agent-a, model-x",
      "Outcome: succeeded after 2 attempts",
      "CI attempts: 3",
      "Cycle time: 26.5 h",
      "Cost: 4.2 CHF",
      "Rework afterwards: 25%",
      "Fixes caused: 1",
    ]);
  });

  it("shows only what is known, and a pending retrospective metric as n/a with its reason", () => {
    const rows = frameCardRows(frame(0, "feature", { rework_after_pending: true }), fmt);
    expect(rows.map((r) => r.label)).toEqual(["Kind", "Scope", "Rework afterwards"]);
    expect(rows[2]).toMatchObject({ value: "n/a", note: "Pending: needs 14 days of later history." });
  });
});

describe("factory panel", () => {
  const view = factoryView(factory, "last30", fmt);

  it("shows every KPI with its sample size and the previous period beside it", () => {
    expect(view.kpis.map((k) => `${k.label}: ${k.value} (${k.sample}, previous ${k.previous})`)).toEqual([
      "Throughput: 2.8 (12 issues, previous 2)",
      "Fix share: 25% (12 issues, previous n/a)",
      "Change fail rate: n/a (3 issues, previous n/a)",
      "Cycle time: 7.3 (12 issues, previous n/a)",
    ]);
    expect(view.kpis[2]).toMatchObject({ reason: "needs at least 5 issues, has 3", experimental: true });
    expect(view.notice).toBe("Questions, not targets.");
  });

  it("hides the KPIs of higher data levels and says why", () => {
    expect(view.kpis.map((k) => k.id)).not.toContain("cost_per_merged_issue");
    expect(view.hidden).toBe(
      "1 more KPIs need a higher data level: GitHub data through gh, or a facts file.",
    );
  });

  it("puts agents side by side with their sample sizes, and flags small groups", () => {
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]).toMatchObject({ name: "agent", warn: true });
    expect(view.groups[0]?.columns).toEqual([
      { value: "a", issues: 10, comparable: true },
      { value: "b", issues: 2, comparable: false },
    ]);
    expect(view.groups[0]?.rows).toEqual([{ label: "Throughput", cells: ["2", "too few"] }]);
  });

  it("lists the issues to look at, with the frame to jump to, and skips empty lists", () => {
    expect(view.lists).toEqual([
      {
        title: "Worst quality delta (points lost)",
        lines: [{ frame: 4, issue: 5, label: "#5 Title", value: 3.5 }],
      },
    ]);
  });

  it("switches period", () => {
    expect(factoryView(factory, "all", fmt)).toMatchObject({ period: "all" });
    expect(factoryView(factory, "all", fmt).periods.map((p) => p.issues)).toEqual([12, 40]);
  });

  it("says what to do without a per-issue timeline", () => {
    const none = factoryView(undefined, undefined, fmt);
    expect(none.available).toBe(false);
    expect(none.reason).toContain("timeline --by issue");
  });

  it("formats a KPI by its unit", () => {
    expect(kpiText({ value: 0.456, n: 9 }, { label: "", definition: "", level: 1, unit: "ratio" }, fmt)).toBe(
      "46%",
    );
    expect(kpiText({ n: 0 }, { label: "", definition: "", level: 1, unit: "ratio" }, fmt)).toBe("n/a");
  });
});

describe("Cost preset", () => {
  it("is experimental, needs the cost share, and is unavailable without it", () => {
    const withCost = makeModel(SAMPLE.map((s) => ({ ...s, values: { ...s.values, cost_share: 2 } })));
    const status = presetStatuses(withCost).find((s) => s.preset.id === "cost");
    expect(status).toMatchObject({ available: true });
    expect(status?.preset).toMatchObject({
      experimental: true,
      group: "Factory",
      level: 3,
      question: "Where does the money go?",
    });
    expect(presetStatuses(makeModel(SAMPLE)).find((s) => s.preset.id === "cost")?.available).toBe(false);
  });
});
