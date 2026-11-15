import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Report } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { buildDiff } from "../src/diff.js";
import { DIMENSIONS, levelOf, rate, resolveDimensions } from "../src/health/dimensions.js";
import { computeHealth, findHiddenLinks, findHotspots, type HealthFile } from "../src/health/health.js";
import { reportMarkdown } from "../src/health/markdown.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";

const dims = resolveDimensions();
const dim = (id: string) => dims.find((d) => d.id === id) as (typeof dims)[number];
const file = (path: string, values: Record<string, number>, isTest = false): HealthFile => ({
  path,
  values,
  isTest,
});

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
const FILES: HealthFile[] = [
  file("ok.ts", {
    rloc: 400,
    mcc: 30,
    max_function_complexity: 8,
    max_nesting_level: 2,
    imports_out: 3,
    escape_hatch_density: 0,
    recent_commits: 1,
    fix_commits_recent: 0,
  }),
  file("complex.ts", {
    rloc: 300,
    mcc: 120,
    max_function_complexity: 25,
    max_nesting_level: 3,
    imports_out: 4,
    escape_hatch_density: 0,
    recent_commits: 8,
    fix_commits_recent: 2,
  }),
  file("big.ts", {
    rloc: 200,
    mcc: 60,
    max_function_complexity: 12,
    max_nesting_level: 7,
    imports_out: 2,
    escape_hatch_density: 0,
    recent_commits: 0,
    fix_commits_recent: 0,
  }),
  file("consts.ts", {
    rloc: 100,
    mcc: 1,
    max_nesting_level: 0,
    imports_out: 0,
    escape_hatch_density: 0,
    recent_commits: 0,
    fix_commits_recent: 0,
  }),
];

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

describe("hidden links (experimental)", () => {
  it("finds files of different folders that change together without an import", () => {
    const links = findHiddenLinks({
      coChange: [
        ["ui/form.ts", "api/schema.ts"],
        ["ui/a.ts", "ui/b.ts"],
        ["core/x.ts", "lib/y.ts"],
      ],
      imports: [["core/x.ts", "lib/y.ts"]],
    });
    expect(links).toEqual([
      {
        kind: "co-change-without-import",
        files: ["api/schema.ts", "ui/form.ts"],
        detail: "These files change together but neither imports the other.",
      },
    ]);
  });

  it("finds files whose imports mostly go to another folder than their own", () => {
    const links = findHiddenLinks({
      imports: [
        ["ui/helper.ts", "core/a.ts"],
        ["ui/helper.ts", "core/b.ts"],
        ["ui/helper.ts", "core/c.ts"],
        ["ui/helper.ts", "ui/x.ts"],
        ["ui/small.ts", "core/a.ts"],
      ],
    });
    expect(links).toEqual([
      {
        kind: "imports-mostly-elsewhere",
        files: ["ui/helper.ts"],
        detail: "3 of its 4 imports go to core: it may belong there.",
      },
    ]);
  });
});

function report(): Report {
  return {
    kind: "report",
    schemaVersion: 1,
    analyzerVersion: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    project: "demo",
    commit: "abc1234",
    dataLevel: 1,
    health: computeHealth(FILES, dims),
    dimensions: dims,
    hotspots: findHotspots(FILES, dims),
    hiddenLinks: [],
    notice: "The score is a heuristic.",
  };
}

describe("report in Markdown", () => {
  const md = reportMarkdown(report(), 1);

  it("shows the score with its notice and the dimensions used", () => {
    expect(md).toContain("## Score: 10 out of 100");
    expect(md).toContain("The score is a heuristic.");
    expect(md).toContain("Dimensions used: File size, Complexity, Nesting, Coupling, Shortcuts.");
  });

  it("shows the risk profile and what is unavailable", () => {
    expect(md).toContain("| Complexity | 44% | 22% | 33% | 0% | 90% |");
    expect(md).toContain("Unavailable at this data level or for this code: Cohesion, Duplication, Rework.");
  });

  it("lists every threshold with its source", () => {
    expect(md).toContain(
      "- **File size** (`rloc`): low up to 200, moderate up to 400, high up to 750. Source: project default, not a standard.",
    );
    expect(md).toContain("files of at least 100 real lines");
  });

  it("has one issue-ready block per hotspot: title, context, to do, acceptance criteria, size", () => {
    expect(md).toContain("## Hotspots (top 1)");
    expect(md).toContain("### 1. complex.ts");
    expect(md).toContain(
      "**Title:** Extract functions from the most complex one (complexity 25) in `complex.ts`",
    );
    expect(md).toContain("- [ ] complexity of `complex.ts` is at most 20");
    expect(md).toContain("- [ ] behavior is unchanged and tests pass");
    expect(md).toContain("**Size:** M");
    expect(md).not.toContain("### 2.");
  });

  it("is deterministic", () => {
    expect(reportMarkdown(report(), 5)).toBe(reportMarkdown(report(), 5));
  });
});

const fn = (name: string, depth: number) =>
  `export function ${name}(x: number) {\n${"  if (x) {\n".repeat(depth)}  return x;\n${"  }\n".repeat(depth)}}\n`;

describe("health on a repository", () => {
  it("writes a report with the analysis, with the names of the cohesion groups", async () => {
    const big = Array.from(
      { length: 40 },
      (_, i) => `export function alpha${i}Thing() { return ${i}; }`,
    ).join("\n");
    const other = Array.from(
      { length: 40 },
      (_, i) =>
        `export function zeta${i}() { return ${i}; }\nexport function omega${i}Value() { return ${i}; }`,
    ).join("\n");
    const result = await analyze({
      folder: makeTree({ "src/mixed.ts": `${big}\n${other}\n`, "src/deep.ts": fn("deep", 7) }),
    });
    expect(result.report.health.score).toBeLessThan(100);
    expect(result.report.dimensions.map((d) => d.id)).toContain("cohesion");
    const mixed = result.report.hotspots.find((h) => h.path === "src/mixed.ts");
    expect(mixed?.actions[0]?.type).toBe("split-file");
    expect(mixed?.actions[0]?.text).toContain("alpha0Thing");
    // names of declarations only: no source code in the report
    const text = JSON.stringify(result.report);
    expect(text).not.toContain("return 3");
    expect(text).not.toContain("x: number");
    expect(text).not.toContain("function ");
  });

  it("uses the thresholds of the configuration", async () => {
    const files = {
      "a.ts": fn("a", 2),
      "factory-city.config.json": '{ "thresholds": { "nesting": [1, 1, 1] } }',
    };
    const strict = await analyze({ folder: makeTree(files) });
    expect(strict.report.health.profile.nesting?.veryHigh).toBe(1);
    expect(strict.report.health.score).toBe(0);
    const lax = await analyze({ folder: makeTree({ "a.ts": fn("a", 2) }) });
    expect(lax.report.health.score).toBe(100);
  });

  it("gives each frame its health, quality delta, hotspots and shortcuts added", async () => {
    const dir = initRepo({ "a.ts": fn("a", 1) });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
    writeFileSync(join(dir, "b.ts"), `${fn("b", 7)}export const z: any = 1;\n`);
    commitAt(dir, "2026-01-02T10:00:00Z", "feat: add a deep file");
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: dir, by: "commit" }, out);
    const [first, second] = manifest.frames;
    expect(first?.health?.score).toBe(100);
    expect(first?.metrics.quality_delta).toBeUndefined();
    // a.ts: 5 real lines, healthy; b.ts: 18 real lines, nesting very high
    expect(second?.health?.score).toBeCloseTo((5 / 23) * 100, 1);
    expect(second?.metrics.quality_delta).toBeCloseTo((5 / 23) * 100 - 100, 1);
    expect(second?.metrics).toMatchObject({ hotspots_created: 1, hotspots_resolved: 0, shortcuts_added: 1 });
    expect(second?.health?.profile.nesting?.veryHigh).toBeCloseTo(18 / 23, 3);
    const stored = JSON.parse(readFileSync(join(out, "report.commit.json"), "utf8")) as Report;
    expect(stored.health.score).toBe(second?.health?.score);
  });

  it("adds the quality delta and the hotspots to a diff", async () => {
    const dir = initRepo({ "a.ts": fn("a", 1) });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
    git(dir, "checkout", "-q", "-b", "feat/1-x");
    writeFileSync(join(dir, "b.ts"), fn("b", 7));
    commitAt(dir, "2026-01-02T10:00:00Z", "feat: deep");
    const { summary } = await buildDiff({ folder: dir }, makeTree({}));
    expect(summary.quality.base).toBe(100);
    expect(summary.quality.delta).toBeLessThan(0);
    expect(summary.hotspots).toEqual({ created: ["b.ts"], resolved: [] });
  });
});

describe("report command", () => {
  const BIN = join(import.meta.dirname, "..", "dist", "cli", "main.js");
  const run = (args: string[], home: string) =>
    execFileSync("node", [BIN, ...args], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_CITY_HOME: home },
    });

  it("prints Markdown by default and JSON on demand, for a folder", () => {
    const dir = makeTree({ "a.ts": fn("a", 6), "b.ts": fn("b", 1) });
    const home = makeTree({});
    const md = run(["report", dir, "--top", "1"], home);
    expect(md).toContain("# Code health:");
    expect(md).toContain("### 1. a.ts");
    expect(md).not.toContain("### 2.");
    const json = JSON.parse(run(["report", dir, "--format", "json"], home)) as Report;
    expect(json.kind).toBe("report");
    expect(json.health.score).toBeLessThan(100);
  });

  it("reads the report of a data folder without analyzing again", () => {
    const dir = makeTree({ "a.ts": fn("a", 6) });
    const out = makeTree({});
    run(["analyze", dir, "-o", out], makeTree({}));
    expect(run(["report", out], makeTree({}))).toContain("### 1. a.ts");
  });
});
