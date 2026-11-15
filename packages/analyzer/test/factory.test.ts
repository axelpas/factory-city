import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CcJson, Factory, Facts, Frame } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { ciAttempts, estimateOf, hoursBetween, median, scopeGap } from "../src/collectors/delivery.js";
import { addCostShares, enrichFrames } from "../src/collectors/enrich.js";
import type { GhRunner } from "../src/collectors/forge.js";
import { computeFactory, computeKpis, KPI_DEFINITIONS } from "../src/factory/kpis.js";
import { factoryMarkdown } from "../src/factory/markdown.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "gh");
const replay: GhRunner = async (args) => {
  const file = args[0] === "issue" ? "issues.json" : args[0] === "pr" ? "pulls.json" : "runs.json";
  return readFileSync(join(FIXTURES, file), "utf8");
};

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

function frame(index: number, patch: Partial<Frame> = {}, metrics: Partial<Frame["metrics"]> = {}): Frame {
  return {
    id: `f${index}`,
    index,
    kind: "feature",
    label: `#${index + 1}`,
    date: `2026-03-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    commit: `c${index}`,
    subject: "s",
    commits: [],
    snapshot: "",
    totals: { files: 0, rloc: 0, mcc: 0 },
    added: [],
    modified: [],
    deleted: [],
    metrics: { files_touched: 1, lines_added: 10, lines_deleted: 0, folders_touched: 1, ...metrics },
    lines: {},
    issue: { number: index + 1 },
    ...patch,
  };
}

/**
 * Six issues with every field filled by hand, so that each KPI can be checked against a value worked out
 * on paper. Days 1 to 6 of March 2026.
 */
const SIX: Frame[] = [
  frame(
    0,
    { kind: "feature" },
    {
      folders_touched: 1,
      lines_written: 100,
      rework_after: 0.1,
      alive_30: 0.9,
      alive_90: 0.8,
      caused_fixes: 0,
      quality_delta: 2,
      first_pass_green: true,
      ci_attempts: 1,
      cycle_time_hours: 4,
      scope_gap: false,
      agent: "a",
      model: "x",
      estimate: "S",
      attempts: 1,
      succeeded_attempts: 1,
      review_blockers: 0,
      review_majors: 1,
      rework_rounds: 0,
      human_interventions: 0,
      agent_minutes: 10,
      cost: 1,
    },
  ),
  frame(
    1,
    { kind: "fix" },
    {
      folders_touched: 2,
      lines_written: 300,
      rework_after: 0.5,
      alive_30: 0.5,
      alive_90: 0.4,
      caused_fixes: 2,
      quality_delta: -4,
      first_pass_green: false,
      ci_attempts: 3,
      cycle_time_hours: 10,
      scope_gap: true,
      agent: "a",
      model: "x",
      estimate: "S",
      attempts: 2,
      succeeded_attempts: 1,
      review_blockers: 2,
      review_majors: 1,
      rework_rounds: 2,
      human_interventions: 1,
      agent_minutes: 30,
      cost: 3,
    },
  ),
  frame(
    2,
    { kind: "feature" },
    {
      folders_touched: 3,
      lines_written: 100,
      rework_after: 0,
      alive_30: 1,
      alive_90: 1,
      caused_fixes: 0,
      quality_delta: 0,
      first_pass_green: true,
      ci_attempts: 1,
      cycle_time_hours: 6,
      scope_gap: false,
      agent: "b",
      model: "y",
      estimate: "M",
      attempts: 1,
      succeeded_attempts: 1,
      review_blockers: 0,
      review_majors: 0,
      rework_rounds: 0,
      human_interventions: 0,
      agent_minutes: 20,
      cost: 2,
    },
  ),
  frame(
    3,
    { kind: "fix" },
    {
      folders_touched: 4,
      lines_written: 100,
      rework_after: 0.3,
      alive_30: 0.7,
      caused_fixes: 1,
      quality_delta: -2,
      first_pass_green: true,
      ci_attempts: 1,
      cycle_time_hours: 8,
      scope_gap: false,
      agent: "b",
      model: "y",
      estimate: "M",
      attempts: 1,
      succeeded_attempts: 0,
      review_blockers: 1,
      review_majors: 0,
      rework_rounds: 1,
      human_interventions: 2,
      agent_minutes: 40,
      cost: 4,
    },
  ),
  frame(
    4,
    { kind: "refactor" },
    {
      folders_touched: 5,
      lines_written: 500,
      rework_after: 0.2,
      alive_30: 0.8,
      caused_fixes: 0,
      quality_delta: 4,
      first_pass_green: false,
      ci_attempts: 2,
      cycle_time_hours: 100,
      scope_gap: false,
      agent: "a",
      model: "x",
      estimate: "L",
      attempts: 3,
      succeeded_attempts: 1,
      review_blockers: 0,
      review_majors: 0,
      rework_rounds: 3,
      human_interventions: 0,
      agent_minutes: 50,
      cost: 5,
    },
  ),
  frame(
    5,
    { kind: "docs" },
    {
      folders_touched: 1,
      lines_written: 0,
      caused_fixes: 0,
      quality_delta: 0,
      first_pass_green: true,
      ci_attempts: 1,
      cycle_time_hours: 2,
      scope_gap: false,
      agent: "b",
      model: "y",
      estimate: "S",
      attempts: 1,
      succeeded_attempts: 1,
      review_blockers: 0,
      review_majors: 0,
      rework_rounds: 0,
      human_interventions: 0,
      agent_minutes: 60,
      cost: 9,
    },
  ),
];

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

describe("enriching frames from the forge and the facts", () => {
  const facts: Facts = {
    kind: "facts",
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    rows: { read: 2, kept: 2, skipped: 0 },
    fields: ["issue", "agent", "cost"],
    facts: [
      {
        issue: 1,
        agent: "a",
        model: "x",
        outcome: "succeeded",
        estimate: "L",
        attempts: 2,
        succeeded_attempts: 1,
        minutes: 12,
        cost: 3,
        currency: "CHF",
        tags: { team: "blue" },
      },
      { commit: "c1", agent: "b", attempts: 1, succeeded_attempts: 0, tags: {} },
    ],
  };

  it("adds what the facts know, and leaves the rest absent", () => {
    const frames = [frame(0), frame(1, { issue: undefined, commit: "c1abc" }), frame(2)];
    enrichFrames(frames, { facts });
    expect(frames[0]?.metrics).toMatchObject({
      agent: "a",
      model: "x",
      outcome: "succeeded",
      attempts: 2,
      succeeded_attempts: 1,
      agent_minutes: 12,
      cost: 3,
      currency: "CHF",
      estimate: "L",
      tags: { team: "blue" },
    });
    expect(frames[0]?.metrics).not.toHaveProperty("human_interventions");
    expect(frames[1]?.metrics).toMatchObject({ agent: "b", attempts: 1 });
    expect(frames[2]?.metrics).not.toHaveProperty("agent");
    expect(frames[2]?.metrics).not.toHaveProperty("cost");
  });

  it("prefers the issue's own size label over the facts' estimate", () => {
    const frames = [frame(0, { issue: { number: 1, labels: ["size:S"] } })];
    enrichFrames(frames, { facts });
    expect(frames[0]?.metrics.estimate).toBe("S");
  });

  it("splits a frame's cost over its files by the lines changed, and accumulates", () => {
    const total = new Map<string, number>();
    addCostShares(total, { "a.ts": [30, 0], "b.ts": [5, 5] }, 8);
    expect(total).toEqual(
      new Map([
        ["a.ts", 6],
        ["b.ts", 2],
      ]),
    );
    addCostShares(total, { "a.ts": [1, 0] }, 4);
    expect(total.get("a.ts")).toBe(10);
    addCostShares(total, { "a.ts": [1, 0] }, undefined);
    addCostShares(total, {}, 5);
    expect(total.get("a.ts")).toBe(10);
  });
});

/** The synthetic history of the issue tests, shortened: a pull request merge (#5 for #2) and a squash (#7 for #3). */
function repo(): string {
  const dir = initRepo();
  let n = 0;
  const change = (file = "a.ts") => writeFileSync(join(dir, file), `export const v = ${++n};\n`);
  change();
  commitAt(dir, "2026-01-01T10:00:00Z", "chore: set up\n\nCloses #1");
  git(dir, "checkout", "-q", "-b", "feat/2-parser");
  change("parser.ts");
  commitAt(dir, "2026-01-02T10:00:00Z", "start the parser");
  git(dir, "checkout", "-q", "main");
  execFileSync(
    "git",
    [
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.com",
      "merge",
      "-q",
      "--no-ff",
      "feat/2-parser",
      "-m",
      "Merge pull request #5 from acme/feat/2-parser",
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        GIT_COMMITTER_DATE: "2026-01-03T10:00:00Z",
        GIT_AUTHOR_DATE: "2026-01-03T10:00:00Z",
      },
    },
  );
  change("csv.ts");
  commitAt(dir, "2026-01-04T10:00:00Z", "feat: csv export (#7)");
  return dir;
}

const FACTS_FILE = [
  "issue;agent;model;result;minutes;cost;currency",
  "#2;agent-a;model-x;succeeded;30;2.5;CHF",
  "#3;agent-b;model-y;succeeded;10;1;CHF",
].join("\n");
const FACTS_CONFIG = JSON.stringify({
  facts: {
    columns: {
      issue: "issue",
      agent: "agent",
      model: "model",
      outcome: "result",
      minutes: "minutes",
      cost: "cost",
      currency: "currency",
    },
  },
});

describe("a per-issue timeline with recorded gh output and a synthetic facts file", () => {
  it("fills the level 2 and level 3 frame metrics and reaches data level 3", async () => {
    const dir = repo();
    writeFileSync(join(dir, "factory-city.config.json"), FACTS_CONFIG);
    const factsPath = join(makeTree({ "facts.csv": FACTS_FILE }), "facts.csv");
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: dir, by: "issue", gh: replay, facts: factsPath }, out);
    expect(manifest.dataLevel).toBe(3);
    const [one, two, three] = manifest.frames;
    // #1: closed two hours after it was opened, sized S, no pull request: no CI metric
    expect(one?.metrics).toMatchObject({ estimate: "S", cycle_time_hours: 2 });
    expect(one?.metrics).not.toHaveProperty("ci_attempts");
    expect(one?.metrics).not.toHaveProperty("agent");
    // #2 through pull request #5: first commit red, second green
    expect(two?.metrics).toMatchObject({
      estimate: "M",
      cycle_time_hours: 48,
      ci_attempts: 2,
      first_pass_green: false,
      agent: "agent-a",
      model: "model-x",
      outcome: "succeeded",
      agent_minutes: 30,
      cost: 2.5,
      currency: "CHF",
    });
    // #3 through pull request #7: green at once; no size label
    expect(three?.metrics).toMatchObject({
      cycle_time_hours: 24,
      ci_attempts: 1,
      first_pass_green: true,
      agent: "agent-b",
      cost: 1,
    });
    expect(three?.metrics).not.toHaveProperty("estimate");
    // under 5 earlier issues: the scope gap is unknown
    expect(two?.metrics).not.toHaveProperty("scope_gap");
  });

  it("writes facts.json and factory.json next to the timeline, and the cost share in the snapshots", async () => {
    const dir = repo();
    writeFileSync(join(dir, "factory-city.config.json"), FACTS_CONFIG);
    const out = makeTree({});
    const { manifest } = await buildTimeline(
      { folder: dir, by: "issue", gh: replay, facts: join(makeTree({ "f.csv": FACTS_FILE }), "f.csv") },
      out,
    );
    const facts = JSON.parse(readFileSync(join(out, "facts.json"), "utf8")) as Facts;
    expect(facts.facts.map((f) => f.issue)).toEqual([2, 3]);
    const factory = JSON.parse(readFileSync(join(out, "factory.json"), "utf8")) as Factory;
    expect(factory.periods[1]?.issues).toBe(3);
    expect(factory.dataLevel).toBe(3);
    expect(manifest.metrics).toContain("cost_share");
    const last = JSON.parse(
      readFileSync(join(out, manifest.frames[2]?.snapshot as string), "utf8"),
    ) as CcJson;
    const byName = new Map<string, Record<string, number>>();
    for (const node of last.files[0]?.children ?? [])
      byName.set(node.name, last.lenses.metrics.attributes[node.id] ?? {});
    // parser.ts was touched by #2 only (cost 2.5), csv.ts by #3 only (cost 1)
    expect(byName.get("parser.ts")?.cost_share).toBe(2.5);
    expect(byName.get("csv.ts")?.cost_share).toBe(1);
    // a.ts was touched by #1, which has no cost: unavailable, not zero
    expect(byName.get("a.ts")).not.toHaveProperty("cost_share");
  });

  it("without gh and without facts: level 1, no level 2 or 3 metric on any frame, no facts file", async () => {
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: repo(), by: "issue", offline: true }, out);
    expect(manifest.dataLevel).toBe(1);
    for (const f of manifest.frames) {
      for (const key of ["estimate", "ci_attempts", "cycle_time_hours", "agent", "cost", "scope_gap"])
        expect(f.metrics, `${f.label} ${key}`).not.toHaveProperty(key);
    }
    expect(existsSync(join(out, "facts.json"))).toBe(false);
    expect(manifest.metrics).not.toContain("cost_share");
    const factory = JSON.parse(readFileSync(join(out, "factory.json"), "utf8")) as Factory;
    expect(factory.periods[1]?.overall.cost_per_merged_issue).toEqual({
      n: 0,
      reason: "the facts have no cost (level 3)",
    });
  });

  it("imports a facts file whose header uses the known field names, with no mapping", async () => {
    const path = join(makeTree({ "f.csv": "issue,agent,cost\n2,agent-a,7" }), "f.csv");
    const { manifest } = await buildTimeline(
      { folder: repo(), by: "issue", offline: true, facts: path },
      makeTree({}),
    );
    expect(manifest.frames[1]?.metrics).toMatchObject({ agent: "agent-a", cost: 7 });
  });

  it("says what to do when the facts file cannot be read or mapped", async () => {
    await expect(
      buildTimeline({ folder: repo(), by: "issue", offline: true, facts: "/nope/facts.csv" }, makeTree({})),
    ).rejects.toThrow(/could not be read/);
    const path = join(makeTree({ "f.csv": "a;b\n1;2" }), "f.csv");
    await expect(
      buildTimeline({ folder: repo(), by: "issue", offline: true, facts: path }, makeTree({})),
    ).rejects.toThrow(/needs a mapping/);
  });
});
