import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Report } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { buildDiff } from "../src/diff.js";
import { findHiddenLinks } from "../src/health/health.js";
import { reportMarkdown } from "../src/health/markdown.js";
import { buildTimeline } from "../src/timeline.js";
import { fn, report } from "./health-helpers.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";

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

describe("report in Markdown", () => {
  const md = reportMarkdown(report(), 1);

  it("shows the score with its notice and the dimensions used", () => {
    expect(md).toContain("## Score: 10 out of 100");
    expect(md).toContain("The score is a heuristic.");
    expect(md).toContain("Dimensions used: File size, Complexity, Nesting, Coupling, Shortcuts.");
  });

  it("shows the risk profile and what is unavailable", () => {
    expect(md).toContain("| Complexity | 44% | 22% | 33% | 0% | 90% |");
    expect(md).toContain(
      "Unavailable at this data level or for this code: Cohesion, Security signals, Scanner findings, Security fixes, Duplication, Rework.",
    );
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
