import { describe, expect, it } from "vitest";
import { ciAttempts, estimateOf, hoursBetween, median, scopeGap } from "../src/collectors/delivery.js";
import { computeKpis, KPI_DEFINITIONS } from "../src/factory/kpis.js";
import { frame, SIX } from "./factory-helpers.js";

describe("delivery metrics", () => {
  it("reads the estimate from a size label, and from the project's own patterns", () => {
    expect(estimateOf(["bug", "size:S"])).toBe("S");
    expect(estimateOf(["M"])).toBe("M");
    expect(estimateOf(["est: xl"])).toBe("XL");
    expect(estimateOf(["effort/L"])).toBe("L");
    expect(estimateOf(["bug", "small"])).toBeUndefined();
    expect(estimateOf(["t-shirt medium"], ["t-shirt (medium)"])).toBe("MEDIUM");
  });

  it("counts CI attempts up to the first green commit", () => {
    const run = (sha: string, conclusion: string, at: number) => ({
      branch: "b",
      sha,
      conclusion,
      createdAt: `2026-01-01T0${at}:00:00Z`,
    });
    // first commit has one failing run: red; the second is green
    expect(
      ciAttempts(
        [run("a", "failure", 1), run("a", "success", 2), run("b", "success", 3), run("c", "success", 4)],
        "b",
      ),
    ).toEqual({ attempts: 2, firstPassGreen: false, green: true });
    expect(ciAttempts([run("a", "success", 1)], "b")).toEqual({
      attempts: 1,
      firstPassGreen: true,
      green: true,
    });
    expect(ciAttempts([run("a", "failure", 1), run("b", "cancelled", 2)], "b")).toEqual({
      attempts: 2,
      firstPassGreen: false,
      green: false,
    });
  });

  it("has no CI attempts without a completed run: unavailable, not zero", () => {
    expect(ciAttempts([], "b")).toBeUndefined();
    expect(
      ciAttempts([{ branch: "b", sha: "a", conclusion: "", createdAt: "2026-01-01T00:00:00Z" }], "b"),
    ).toBeUndefined();
    expect(
      ciAttempts(
        [{ branch: "other", sha: "a", conclusion: "success", createdAt: "2026-01-01T00:00:00Z" }],
        "b",
      ),
    ).toBeUndefined();
  });

  it("measures hours between two dates", () => {
    expect(hoursBetween("2026-01-01T10:00:00Z", "2026-01-03T10:00:00Z")).toBe(48);
    expect(hoursBetween("2026-01-01T10:00:00Z", undefined)).toBeUndefined();
    expect(hoursBetween("2026-01-03T10:00:00Z", "2026-01-01T10:00:00Z")).toBeUndefined();
  });

  it("flags a scope gap against twice the median of earlier issues with the same estimate", () => {
    const earlier = [1, 2, 3, 4, 5].map((n) => ({ estimate: "S", files: n, lines: n * 10 }));
    // medians: 3 files, 30 lines
    expect(scopeGap({ estimate: "S", files: 7, lines: 20 }, earlier)).toBe(true);
    expect(scopeGap({ estimate: "S", files: 6, lines: 60 }, earlier)).toBe(false);
    expect(scopeGap({ estimate: "S", files: 2, lines: 61 }, earlier)).toBe(true);
  });

  it("leaves the scope gap unknown without an estimate or under 5 earlier issues", () => {
    const earlier = [1, 2, 3, 4].map((n) => ({ estimate: "S", files: n, lines: n }));
    expect(scopeGap({ estimate: "S", files: 99, lines: 99 }, earlier)).toBeUndefined();
    expect(scopeGap({ files: 99, lines: 99 }, [...earlier, ...earlier])).toBeUndefined();
    expect(scopeGap({ estimate: "L", files: 99, lines: 99 }, [...earlier, ...earlier])).toBeUndefined();
  });

  it("computes a median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe("factory KPIs against hand-computed values", () => {
  const k = computeKpis(SIX, 14);

  it("level 1: throughput, fix share, scatter", () => {
    expect(k.throughput).toEqual({ value: 3, n: 6 }); // 6 issues in 14 days
    expect(k.fix_share).toEqual({ value: 0.333, n: 6 }); // 2 of 6
    expect(k.scatter).toEqual({ value: 2.5, n: 6 }); // median of 1 2 3 4 5 1
  });

  it("level 1: rework rate and shelf life, weighted by the lines each issue added", () => {
    // (0.1*100 + 0.5*300 + 0*100 + 0.3*100 + 0.2*500) / 1100 = 290 / 1100
    expect(k.rework_rate).toEqual({ value: 0.264, n: 5 });
    // (0.9*100 + 0.5*300 + 1*100 + 0.7*100 + 0.8*500) / 1100 = 810 / 1100
    expect(k.shelf_life_30).toEqual({ value: 0.736, n: 5 });
    // only three issues have 90 days of later history: unavailable under 5
    expect(k.shelf_life_90).toEqual({ n: 3, reason: "needs at least 5 issues, has 3" });
  });

  it("level 1: change fail rate and quality drift", () => {
    expect(k.change_fail_rate).toEqual({ value: 0.333, n: 6 }); // issues 2 and 4 caused fixes
    expect(k.quality_drift).toEqual({ value: 0, n: 6 }); // 2 - 4 + 0 - 2 + 4 + 0
    expect(k.quality_lowered_share).toEqual({ value: 0.333, n: 6 });
  });

  it("level 2: CI, cycle time, scope gap", () => {
    expect(k.first_pass_green_rate).toEqual({ value: 0.667, n: 6 }); // 4 of 6
    expect(k.ci_attempts_mean).toEqual({ value: 1.5, n: 6 }); // 9 / 6
    expect(k.cycle_time_median).toEqual({ value: 7, n: 6 }); // median of 2 4 6 8 10 100
    expect(k.scope_gap_rate).toEqual({ value: 0.167, n: 6 });
  });

  it("level 3: success, review load, autonomy, effort and spend", () => {
    expect(k.success_rate).toEqual({ value: 0.556, n: 6 }); // 5 succeeded of 9 attempts
    expect(k.review_findings_mean).toEqual({ value: 0.833, n: 6 }); // 5 findings / 6
    expect(k.rework_rounds_mean).toEqual({ value: 1, n: 6 });
    expect(k.autonomy_rate).toEqual({ value: 0.667, n: 6 }); // 4 issues with no intervention
    expect(k.minutes_per_merged_issue).toEqual({ value: 35, n: 6 });
    expect(k.cost_per_merged_issue).toEqual({ value: 4, n: 6 });
  });

  it("defines every KPI it computes, with its level", () => {
    expect(Object.keys(k).sort()).toEqual(Object.keys(KPI_DEFINITIONS).sort());
    expect(KPI_DEFINITIONS.change_fail_rate?.experimental).toBe(true);
    expect(KPI_DEFINITIONS.autonomy_rate?.level).toBe(3);
  });
});

describe("unavailable is not zero", () => {
  const bare = [0, 1, 2, 3, 4, 5].map((i) => frame(i));

  it("level 1 only: every level 2 and level 3 KPI is unavailable, with a reason", () => {
    const k = computeKpis(bare, 14);
    for (const [id, def] of Object.entries(KPI_DEFINITIONS)) {
      if (def.level === 1) continue;
      expect(k[id]?.value, id).toBeUndefined();
      expect(k[id]?.n, id).toBe(0);
      expect(k[id]?.reason, id).toBeTruthy();
    }
    expect(k.cost_per_merged_issue?.reason).toBe("the facts have no cost (level 3)");
    expect(k.throughput?.value).toBe(3);
  });

  it("without provenance: rework and shelf life are unavailable", () => {
    const k = computeKpis(bare, 14);
    expect(k.rework_rate).toEqual({ n: 0, reason: "needs more later history: 14 days after each issue" });
    expect(k.change_fail_rate?.value).toBeUndefined();
    expect(k.quality_drift?.value).toBeUndefined();
  });

  it("a field missing from the facts leaves its KPI unavailable while the others are computed", () => {
    const noCost = SIX.map((f) => {
      const { cost, human_interventions, ...rest } = f.metrics;
      return { ...f, metrics: rest };
    });
    const k = computeKpis(noCost, 14);
    expect(k.cost_per_merged_issue).toEqual({ n: 0, reason: "the facts have no cost (level 3)" });
    expect(k.autonomy_rate?.value).toBeUndefined();
    expect(k.minutes_per_merged_issue?.value).toBe(35);
  });

  it("stays unavailable under 5 issues, and says how many it has", () => {
    const k = computeKpis(SIX.slice(0, 4), 14);
    for (const kpi of Object.values(k)) expect(kpi.value).toBeUndefined();
    expect(k.throughput).toEqual({ n: 4, reason: "needs at least 5 issues, has 4" });
  });

  it("handles no issue at all", () => {
    expect(computeKpis([], 30).throughput).toEqual({ n: 0, reason: "no issue in this period" });
  });
});
