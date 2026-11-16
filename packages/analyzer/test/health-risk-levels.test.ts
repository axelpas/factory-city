import { describe, expect, it } from "vitest";
import { DIMENSIONS, levelOf, rate, resolveDimensions } from "../src/health/dimensions.js";
import { computeHealth, findHotspots, type HealthFile } from "../src/health/health.js";
import { dim, dims, FILES, file } from "./health-helpers.js";

describe("risk levels", () => {
  it("rates a value against the bounds of its dimension, bounds included", () => {
    const c = dim("complexity");
    expect([1, 10, 11, 20, 21, 50, 51].map((v) => levelOf(v, c))).toEqual([
      "low",
      "low",
      "moderate",
      "moderate",
      "high",
      "high",
      "veryHigh",
    ]);
  });

  it("does not rate a dimension the file has no value for: unavailable is not low", () => {
    expect(rate({ rloc: 50 }, dim("complexity"))).toBeUndefined();
    expect(rate({ rloc: 50, recent_commits: 0 }, dim("change"))).toBe("low");
  });

  it("rates cohesion only for files above a minimum size", () => {
    expect(rate({ rloc: 60, cohesion_groups: 6 }, dim("cohesion"))).toBeUndefined();
    expect(rate({ rloc: 100, cohesion_groups: 6 }, dim("cohesion"))).toBe("veryHigh");
  });

  it("documents every threshold with a source, or says it is a project default", () => {
    for (const d of DIMENSIONS) {
      expect(d.source.length, d.id).toBeGreaterThan(10);
      expect(d.bounds[0] <= d.bounds[1] && d.bounds[1] <= d.bounds[2], d.id).toBe(true);
    }
    expect(dim("size").source).toBe("project default, not a standard");
    expect(dim("complexity").source).toContain("McCabe");
  });

  it("takes threshold overrides from the configuration", () => {
    const custom = resolveDimensions({ size: [50, 100, 150] });
    expect(custom.find((d) => d.id === "size")).toMatchObject({
      bounds: [50, 100, 150],
      source: "set in factory-city.config.json",
    });
    expect(custom.find((d) => d.id === "nesting")?.bounds).toEqual([3, 4, 6]);
  });
});

/** 1,000 real lines: 400 healthy, 300 complex, 200 large and deeply nested, 100 with no function. */

describe("risk profile and score", () => {
  const health = computeHealth(FILES, dims);

  it("gives the share of code at each level, by real lines", () => {
    // complexity is rated for 900 lines: 400 low, 200 moderate, 300 high
    expect(health.profile.complexity).toEqual({
      low: 0.4444,
      moderate: 0.2222,
      high: 0.3333,
      veryHigh: 0,
      rated: 0.9,
    });
    // size: 400 lines is moderate (bound 400), 300 moderate, 200 and 100 low
    expect(health.profile.size).toEqual({ low: 0.3, moderate: 0.7, high: 0, veryHigh: 0, rated: 1 });
    expect(health.profile.nesting).toMatchObject({ low: 0.8, veryHigh: 0.2 });
    expect(health.profile.change).toMatchObject({ low: 0.7, high: 0.3 });
  });

  it("leaves out a dimension with no rated code instead of showing zeros", () => {
    expect(health.profile).not.toHaveProperty("duplication");
    expect(health.profile).not.toHaveProperty("rework");
    expect(health.profile).not.toHaveProperty("cohesion");
  });

  it("scores the share of code that is low risk on every static dimension available for it", () => {
    // ok.ts is moderate on size, complex.ts and big.ts are not low: only consts.ts (100 of 1,000) is healthy
    expect(health.score).toBe(10);
    expect(health.scored).toEqual(["size", "complexity", "nesting", "coupling", "shortcuts"]);
  });

  it("keeps history out of the score", () => {
    const calm = computeHealth(
      FILES.map((f) => ({ ...f, values: { ...f.values, recent_commits: 0, fix_commits_recent: 0 } })),
      dims,
    );
    const busy = computeHealth(
      FILES.map((f) => ({ ...f, values: { ...f.values, recent_commits: 50, fix_commits_recent: 9 } })),
      dims,
    );
    expect(busy.score).toBe(calm.score);
    expect(busy.profile.change?.veryHigh).toBe(1);
  });

  it("scores 100 for empty input and for entirely healthy code", () => {
    expect(computeHealth([], dims).score).toBe(100);
    expect(
      computeHealth([file("a.ts", { rloc: 10, max_function_complexity: 1, max_nesting_level: 0 })], dims)
        .score,
    ).toBe(100);
  });
});

describe("hotspots", () => {
  it("ranks complex code that changes often first, and leaves out files that did not change", () => {
    const hotspots = findHotspots(FILES, dims);
    expect(hotspots.map((h) => h.path)).toEqual(["complex.ts", "ok.ts"]);
    expect(hotspots[0]).toMatchObject({ rank: 1, basis: "complexity-and-change", size: "M" });
    expect(hotspots[0]?.exceeded).toEqual([
      { dimension: "complexity", level: "high", value: 25, bound: 20 },
      { dimension: "change", level: "high", value: 8, bound: 5 },
      { dimension: "fixes", level: "high", value: 2, bound: 1 },
    ]);
  });

  it("ranks by complexity and size when there is no history", () => {
    const plain = FILES.map((f) => ({
      ...f,
      values: { rloc: f.values.rloc as number, mcc: f.values.mcc as number },
    }));
    const hotspots = findHotspots(plain, dims);
    expect(hotspots[0]).toMatchObject({ path: "complex.ts", basis: "complexity-and-size" });
    expect(hotspots).toHaveLength(4);
  });

  it("suggests actions from the thresholds exceeded, with a rough size", () => {
    const [top] = findHotspots(FILES, dims);
    expect(top?.actions.map((a) => a.type)).toEqual(["extract-functions", "add-tests"]);
    expect(top?.actions[1]?.text).toBe("Add tests before the next change (2 recent fixes).");
    const nested = findHotspots([FILES[2] as HealthFile], dims)[0];
    expect(nested?.actions.map((a) => a.type)).toEqual(["flatten-nesting"]);
    const huge = findHotspots([file("huge.ts", { rloc: 900, mcc: 40, max_function_complexity: 5 })], dims)[0];
    expect(huge).toMatchObject({ size: "L" });
    expect(huge?.actions[0]).toEqual({ type: "split-file", text: "Split the file (900 real lines)." });
  });

  it("names the cohesion groups to split along, the shortcut kinds, and the contention", () => {
    const f = file("mixed.ts", {
      rloc: 300,
      mcc: 50,
      cohesion_groups: 3,
      escape_hatch_density: 30,
      escape_hatches: 9,
      escape_any: 7,
      escape_ts_ignore: 2,
      issues_recent: 4,
      imports_out: 40,
    });
    const groups = new Map([
      [
        "mixed.ts",
        [["parseDate", "parseTime", "parseZone", "parseAll"], ["renderTable"], ["sendMail", "sendSms"]],
      ],
    ]);
    const [h] = findHotspots([f], dims, { groups });
    expect(h?.actions.map((a) => a.type)).toEqual([
      "split-file",
      "reduce-imports",
      "remove-shortcuts",
      "separate-concerns",
    ]);
    expect(h?.actions[0]?.text).toBe(
      "Split the file along its 3 groups: (parseDate, parseTime, parseZone, ...) (renderTable) (sendMail, sendSms).",
    );
    expect(h?.actions[2]?.text).toBe("Remove shortcuts: 7 any, 2 @ts-ignore.");
    expect(h?.actions[3]?.text).toBe("Separate what 4 recent issues keep colliding on.");
  });

  it("leaves tests out and is deterministic on ties", () => {
    const twins = [
      file("b.ts", { rloc: 10, mcc: 5 }),
      file("a.ts", { rloc: 10, mcc: 5 }),
      file("a.test.ts", { rloc: 900, mcc: 99 }, true),
    ];
    expect(findHotspots(twins, dims).map((h) => h.path)).toEqual(["a.ts", "b.ts"]);
  });
});
