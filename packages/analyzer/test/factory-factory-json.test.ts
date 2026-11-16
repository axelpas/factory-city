import { describe, expect, it } from "vitest";
import { computeFactory } from "../src/factory/kpis.js";
import { factoryMarkdown } from "../src/factory/markdown.js";
import { frame, SIX } from "./factory-helpers.js";

describe("factory.json", () => {
  const factory = computeFactory({
    project: "demo",
    analyzerVersion: "test",
    dataLevel: 3,
    frames: SIX,
    now: new Date("2026-03-10T00:00:00Z"),
  });

  it("gives the last 30 days against the 30 before, and the whole timeline", () => {
    expect(factory.periods.map((p) => p.id)).toEqual(["last30", "all"]);
    const [last, all] = factory.periods;
    expect(last?.issues).toBe(6);
    expect(last?.to).toBe("2026-03-06T10:00:00.000Z");
    expect(last?.previous?.throughput).toEqual({ n: 0, reason: "no issue in this period" });
    expect(all?.overall.throughput?.value).toBeCloseTo(6 / (5 / 7), 2);
    expect(all).not.toHaveProperty("previous");
  });

  it("groups by agent, model, kind and estimate, and marks small groups as not comparable", () => {
    const groups = factory.periods[1]?.groups ?? {};
    expect(Object.keys(groups)).toEqual(["agent", "model", "kind", "estimate"]);
    expect(groups.agent?.a).toMatchObject({ issues: 3, comparable: false });
    expect(groups.estimate?.S?.issues).toBe(3);
    // three issues per agent: under 5, so the KPI is unavailable for the group
    expect(groups.agent?.a?.kpis.cost_per_merged_issue?.value).toBeUndefined();
  });

  it("groups by the facts file's own columns too", () => {
    const tagged = SIX.map((f, i) => ({
      ...f,
      metrics: { ...f.metrics, tags: { team: i < 3 ? "blue" : "red" } },
    }));
    const groups =
      computeFactory({ project: "demo", analyzerVersion: "t", dataLevel: 3, frames: tagged }).periods[1]
        ?.groups ?? {};
    expect(Object.keys(groups["tag:team"] ?? {})).toEqual(["blue", "red"]);
  });

  it("lists the issues to look at, worst first", () => {
    expect(factory.lists.worst_quality_delta?.map((l) => `${l.label} ${l.value}`)).toEqual(["#2 4", "#4 2"]);
    expect(factory.lists.most_ci_attempts?.map((l) => l.label)).toEqual(["#2", "#5"]);
    expect(factory.lists.highest_rework_after?.[0]).toMatchObject({
      label: "#2",
      value: 0.5,
      frame: 1,
      issue: 2,
    });
    expect(factory.lists.most_caused_fixes?.map((l) => l.label)).toEqual(["#2", "#4"]);
    expect(factory.lists.widest_scope_gap?.map((l) => l.label)).toEqual(["#2"]);
  });

  it("leaves frames of unlinked commits out", () => {
    const withUnlinked = [...SIX, { ...frame(6), issue: undefined, unlinked: true }];
    expect(
      computeFactory({ project: "d", analyzerVersion: "t", dataLevel: 1, frames: withUnlinked }).periods[1]
        ?.issues,
    ).toBe(6);
  });

  it("says that KPIs are questions, not targets, and never a ranking of people", () => {
    expect(factory.notice).toContain("questions to ask about the process, not targets");
    expect(factory.notice).toContain("never a ranking of people");
  });
});

describe("factory section of the report", () => {
  const factory = computeFactory({ project: "demo", analyzerVersion: "test", dataLevel: 3, frames: SIX });

  it("shows each KPI with its sample size and the previous period", () => {
    const md = factoryMarkdown(factory);
    expect(md).toContain("### Last 30 days: 6 issues");
    expect(md).toContain("| Throughput | 1.4 | 6 | n/a | Issues merged per week. |");
    expect(md).toContain("| Fix share | 33% | 6 | n/a |");
    expect(md).toContain("| Shelf life, 90 days | n/a (needs at least 5 issues, has 3) | 3 |");
    expect(md).toContain("| Change fail rate (experimental) |");
  });

  it("does not compare groups under 10 issues: it shows their sizes only", () => {
    const md = factoryMarkdown(factory, { period: "all", by: "agent" });
    expect(md).toContain("### By agent");
    expect(md).toContain("No group has 10 issues yet (a: 3, b: 3): too few to compare.");
    expect(md).not.toContain("| KPI | a (3 issues)");
  });

  it("puts large enough groups side by side with their sizes, and leaves small ones out of the comparison", () => {
    const many = Array.from({ length: 24 }, (_, i) => ({
      ...frame(
        i % 28,
        { kind: "feature" },
        { agent: i < 12 ? "a" : i < 22 ? "b" : "c", agent_minutes: i < 12 ? 10 : 30, cost: 1 },
      ),
      index: i,
      issue: { number: i + 1 },
    }));
    const md = factoryMarkdown(
      computeFactory({ project: "demo", analyzerVersion: "t", dataLevel: 3, frames: many }),
      { period: "all", by: "agent" },
    );
    expect(md).toContain("| KPI | a (12 issues) | b (10 issues) | c (2 issues) |");
    expect(md).toContain("| Minutes per issue | 10 | 30 | too few issues |");
  });

  it("hides the KPIs of higher levels and says how many there are", () => {
    const level1 = computeFactory({ project: "demo", analyzerVersion: "test", dataLevel: 1, frames: SIX });
    const md = factoryMarkdown(level1);
    expect(md).not.toContain("Cost per issue");
    expect(md).toContain("10 more KPIs need a higher data level");
  });

  it("links the issues to look at", () => {
    const linked = SIX.map((f) => ({
      ...f,
      issue: { number: f.index + 1, url: `https://example.org/${f.index + 1}` },
    }));
    const md = factoryMarkdown(
      computeFactory({ project: "demo", analyzerVersion: "t", dataLevel: 3, frames: linked }),
    );
    expect(md).toContain("- [#2](https://example.org/2): 0.5");
  });
});
