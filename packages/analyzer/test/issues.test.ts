import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhRunner } from "../src/collectors/forge.js";
import { loadForge } from "../src/collectors/forge.js";
import {
  branchIssue,
  closingIssues,
  coverageLine,
  type ForgeData,
  kindOf,
  linkStep,
  parseMerge,
  references,
} from "../src/collectors/issues.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "gh");
const recorded = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** Replays recorded `gh` output: no network in tests. */
function replay(calls: string[][] = []): GhRunner {
  return async (args) => {
    calls.push(args);
    if (args[0] === "issue") return recorded("issues.json");
    if (args[0] === "pr") return recorded("pulls.json");
    if (args[0] === "run") return recorded("runs.json");
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
}

const msg = (subject: string, body = "") => ({ hash: "h", subject, body });

describe("finding issue numbers in text", () => {
  it("reads closing keywords, with a repository prefix or a full URL", () => {
    expect(closingIssues("closes #12")).toEqual([12]);
    expect(closingIssues("Fixes: #7 and resolved acme/demo#9")).toEqual([7, 9]);
    expect(closingIssues("fix https://github.com/acme/demo/issues/33")).toEqual([33]);
    expect(closingIssues("fix: repair totals (#12)")).toEqual([]);
    expect(closingIssues("see #12")).toEqual([]);
  });

  it("reads plain references, GH-n and custom patterns, but not anchors or entities", () => {
    expect(references("feat(core): thing (#12)")).toEqual([12]);
    expect(references("GH-8 and gh-9")).toEqual([8, 9]);
    expect(references("color &#123; page#4 url/#5")).toEqual([]);
    expect(references("JIRA ISS-42", ["ISS-(\\d+)"])).toEqual([42]);
  });

  it("reads the issue number of a branch name", () => {
    expect(branchIssue("feat/12-title")).toBe(12);
    expect(branchIssue("12-title")).toBe(12);
    expect(branchIssue("issue-12")).toBe(12);
    expect(branchIssue("fix/issue-7")).toBe(7);
    expect(branchIssue("release-2026")).toBeUndefined();
    expect(branchIssue("feat/add-v2-parser")).toBeUndefined();
  });

  it("reads pull request merges, branch merges and squash subjects", () => {
    expect(parseMerge("Merge pull request #45 from user/12-title")).toEqual({
      pullRequest: 45,
      branch: "12-title",
    });
    expect(parseMerge("Merge pull request #45 from user/feat/12-title")).toEqual({
      pullRequest: 45,
      branch: "feat/12-title",
    });
    expect(parseMerge("Merge branch 'fix/6-total'")).toEqual({ branch: "fix/6-total" });
    expect(parseMerge("feat: csv export (#7)")).toEqual({ pullRequest: 7 });
    expect(parseMerge("feat: plain")).toEqual({});
  });
});

describe("linking a step to an issue, in priority order", () => {
  const forge: ForgeData = {
    issues: new Map(),
    pulls: new Map([
      [45, { number: 45, title: "Thing", body: "", branch: "feat/12-title", url: "", closes: [30] }],
      [46, { number: 46, title: "Other", body: "Part of #31", branch: "misc", url: "", closes: [] }],
      [47, { number: 47, title: "Squashed", body: "", branch: "feat/32-x", url: "", closes: [] }],
    ]),
  };

  it("1. prefers a closing keyword over everything else", () => {
    const link = linkStep(
      msg("Merge pull request #45 from me/feat/12-title"),
      [msg("work", "closes #99")],
      forge,
    );
    expect(link).toMatchObject({ issue: 99, strategy: "closing-keyword", pullRequest: 45 });
  });

  it("2. maps a pull request to the issue the forge says it closes", () => {
    expect(linkStep(msg("Merge pull request #45 from me/feat/12-title"), [msg("work")], forge)).toMatchObject(
      { issue: 30, strategy: "pull-request" },
    );
    expect(linkStep(msg("Merge pull request #46 from me/misc"), [msg("work")], forge)).toMatchObject({
      issue: 31,
      strategy: "pull-request",
    });
    expect(linkStep(msg("feat: squashed (#47)"), [], forge)).toMatchObject({
      issue: 32,
      strategy: "pull-request",
      pullRequest: 47,
    });
  });

  it("3. uses a plain reference, and does not take the pull request number for an issue", () => {
    expect(linkStep(msg("type(scope): description (#12)"), [], undefined)).toMatchObject({
      issue: 12,
      strategy: "reference",
    });
    expect(
      linkStep(msg("Merge pull request #50 from me/topic"), [msg("part of GH-8")], undefined),
    ).toMatchObject({ issue: 8, strategy: "reference" });
  });

  it("4. falls back to the branch name", () => {
    expect(
      linkStep(msg("Merge pull request #50 from me/feat/12-title"), [msg("work")], undefined),
    ).toMatchObject({ issue: 12, strategy: "branch" });
    expect(linkStep(msg("Merge branch 'issue-9'"), [msg("work")], undefined)).toMatchObject({
      issue: 9,
      strategy: "branch",
    });
  });

  it("5. leaves a step unlinked when nothing applies", () => {
    expect(linkStep(msg("tidy up"), [], undefined)).toEqual({
      pullRequest: undefined,
      strategy: "unlinked",
      branch: undefined,
    });
    expect(linkStep(msg("Merge pull request #50 from me/topic"), [msg("work")], undefined).strategy).toBe(
      "unlinked",
    );
  });
});

describe("kind of a step", () => {
  it("reads labels first, then the conventional type, then the branch prefix", () => {
    expect(kindOf("feat: x", "feat/1-x", ["bug"])).toBe("fix");
    expect(kindOf("docs: x", undefined, ["type:feat"])).toBe("feature");
    expect(kindOf("refactor(core): x", "fix/1")).toBe("refactor");
    expect(kindOf("Merge pull request #1 from me/fix/2-y", "fix/2-y")).toBe("fix");
    expect(kindOf("update things", undefined)).toBe("unknown");
  });
});

/**
 * A history that uses every convention at once:
 * c1 closing keyword (#1), a pull request merge (#5, branch feat/2-parser, 2 commits), a squash commit
 * (#7, a pull request closing #3), a plain reference (#4), a branch merge (fix/6-total), unlinked commits.
 */
function syntheticRepo(): string {
  const dir = initRepo();
  let n = 0;
  const change = (file = "a.ts") => writeFileSync(join(dir, file), `export const v = ${++n};\n`);
  const merge = (branch: string, date: string, message: string) =>
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
        branch,
        "-m",
        message,
      ],
      {
        cwd: dir,
        env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
      },
    );
  change();
  commitAt(dir, "2026-01-01T10:00:00Z", "chore: set up\n\nCloses #1");
  git(dir, "checkout", "-q", "-b", "feat/2-parser");
  change("parser.ts");
  commitAt(dir, "2026-01-02T10:00:00Z", "start the parser");
  change("parser.ts");
  commitAt(dir, "2026-01-02T11:00:00Z", "finish the parser");
  git(dir, "checkout", "-q", "main");
  merge("feat/2-parser", "2026-01-03T10:00:00Z", "Merge pull request #5 from acme/feat/2-parser");
  change("csv.ts");
  commitAt(dir, "2026-01-04T10:00:00Z", "feat: csv export (#7)");
  change();
  commitAt(dir, "2026-01-05T09:00:00Z", "tidy imports");
  change();
  commitAt(dir, "2026-01-05T15:00:00Z", "bump version");
  change();
  commitAt(dir, "2026-01-06T10:00:00Z", "fix(core): guard empty input (#4)");
  git(dir, "checkout", "-q", "-b", "fix/6-total");
  change("total.ts");
  commitAt(dir, "2026-01-07T10:00:00Z", "correct the sum");
  git(dir, "checkout", "-q", "main");
  merge("fix/6-total", "2026-01-08T10:00:00Z", "Merge branch 'fix/6-total'");
  change();
  commitAt(dir, "2026-01-09T10:00:00Z", "fix(core): guard again (#4)");
  return dir;
}

describe("timeline per issue", () => {
  it("resolves the synthetic repository with recorded gh output", async () => {
    const calls: string[][] = [];
    const { manifest } = await buildTimeline(
      { folder: syntheticRepo(), by: "issue", gh: replay(calls) },
      makeTree({}),
    );
    expect(manifest.frames.map((f) => f.label)).toEqual([
      "#1 Set up the project",
      "#2 Add the parser",
      "#3 Export as CSV",
      "unlinked 2026-01-05",
      "#6 Wrong total",
      "#4 Crash on empty input",
    ]);
    expect(manifest.frames.map((f) => f.kind)).toEqual([
      "chore",
      "feature",
      "feature",
      "unknown",
      "fix",
      "fix",
    ]);
    expect(manifest.frames[1]?.issue).toEqual({
      number: 2,
      title: "Add the parser",
      state: "closed",
      labels: ["enhancement", "M"],
      url: "https://github.com/acme/demo/issues/2",
      pullRequest: 5,
    });
    expect(manifest.frames[2]?.issue).toMatchObject({ number: 3, pullRequest: 7 });
    expect(manifest.frames[3]).toMatchObject({ unlinked: true });
    expect(manifest.frames[3]?.issue).toBeUndefined();
    expect(manifest.coverage).toEqual({
      commits: 11,
      linked: 9,
      byStrategy: { "closing-keyword": 1, "pull-request": 4, reference: 2, branch: 2, unlinked: 2 },
      issues: 5,
      forge: true,
    });
    expect(manifest.dataLevel).toBe(2);
    expect(manifest.source.mode).toBe("issue");
    // three batched calls, whatever the number of issues
    expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["issue list", "pr list", "run list"]);
  });

  it("shows an issue at the last commit linked to it, ordered by that commit", async () => {
    const { manifest } = await buildTimeline(
      { folder: syntheticRepo(), by: "issue", gh: replay() },
      makeTree({}),
    );
    const four = manifest.frames.at(-1);
    expect(four?.subject).toBe("fix(core): guard again (#4)");
    expect(four?.date.slice(0, 10)).toBe("2026-01-09");
    // the frame of #2 holds the merge and the two commits it brought
    expect(manifest.frames[1]?.commits).toHaveLength(2);
    expect(manifest.frames[1]?.added).toEqual(["parser.ts"]);
  });

  it("resolves the same repository without gh, from git data alone", async () => {
    let asked = false;
    const gh: GhRunner = async () => {
      asked = true;
      return "[]";
    };
    const { manifest } = await buildTimeline(
      { folder: syntheticRepo(), by: "issue", offline: true, gh },
      makeTree({}),
    );
    expect(asked).toBe(false);
    expect(manifest.frames.map((f) => f.label)).toEqual([
      "#1",
      "#2",
      "#7",
      "unlinked 2026-01-05",
      "#6",
      "#4",
    ]);
    expect(manifest.frames.map((f) => f.kind)).toEqual([
      "chore",
      "feature",
      "feature",
      "unknown",
      "fix",
      "fix",
    ]);
    expect(manifest.frames[1]?.issue).toEqual({ number: 2, pullRequest: 5 });
    expect(manifest.coverage).toMatchObject({
      commits: 11,
      linked: 9,
      byStrategy: { "closing-keyword": 1, "pull-request": 0, reference: 3, branch: 5, unlinked: 2 },
      forge: false,
    });
    expect(manifest.dataLevel).toBe(1);
  });

  it("falls back to git data with a warning when gh fails", async () => {
    const failing: GhRunner = async () => {
      throw new Error("HTTP 403: API rate limit exceeded");
    };
    const { manifest } = await buildTimeline(
      { folder: syntheticRepo(), by: "issue", gh: failing },
      makeTree({}),
    );
    expect(manifest.frames).toHaveLength(6);
    expect(manifest.coverage?.forge).toBe(false);
    expect(manifest.warnings.join(" ")).toContain("API rate limit exceeded");
    expect(manifest.warnings.join(" ")).toContain("still found from commit messages");
  });

  it("handles a repository with no issue reference at all", async () => {
    const dir = initRepo({ "a.ts": "export const a = 1;\n" });
    commitAt(dir, "2026-01-01T10:00:00Z", "first");
    writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
    commitAt(dir, "2026-01-02T10:00:00Z", "second");
    const { manifest } = await buildTimeline({ folder: dir, by: "issue", offline: true }, makeTree({}));
    expect(manifest.frames.map((f) => f.label)).toEqual(["unlinked 2026-01-01", "unlinked 2026-01-02"]);
    expect(manifest.coverage).toMatchObject({ commits: 2, linked: 0, issues: 0 });
  });

  it("uses the project's own issue patterns", async () => {
    const dir = initRepo({
      "a.ts": "export const a = 1;\n",
      "factory-city.config.json": '{ "issuePatterns": ["TICKET-(\\\\d+)"] }',
    });
    commitAt(dir, "2026-01-01T10:00:00Z", "TICKET-77 start");
    const { manifest } = await buildTimeline({ folder: dir, by: "issue", offline: true }, makeTree({}));
    expect(manifest.frames.map((f) => f.label)).toEqual(["#77"]);
  });
});

describe("forge data", () => {
  it("is cached on disk and reused without a second call", async () => {
    const cache = join(makeTree({}), "cache", "forge.json");
    const calls: string[][] = [];
    const first = await loadForge(replay(calls), cache, Date.parse("2026-01-10T10:00:00Z"));
    expect(first.issues.get(4)).toMatchObject({
      title: "Crash on empty input",
      state: "open",
      labels: ["bug"],
    });
    expect(first.pulls.get(5)).toMatchObject({ branch: "feat/2-parser", closes: [2] });
    expect(first.runs).toHaveLength(7);
    await loadForge(replay(calls), cache, Date.parse("2026-01-10T10:05:00Z"));
    expect(calls).toHaveLength(3);
    await loadForge(replay(calls), cache, Date.parse("2026-01-10T11:00:00Z"));
    expect(calls).toHaveLength(6);
  });
});

describe("coverage line", () => {
  it("reads in plain language", () => {
    expect(
      coverageLine({
        commits: 10,
        linked: 8,
        byStrategy: { "closing-keyword": 1, "pull-request": 3, reference: 2, branch: 2, unlinked: 2 },
        issues: 5,
        forge: true,
      }),
    ).toBe(
      "Linked 8 of 10 commits (80%) to 5 issues: 1 by closing keyword, 3 by pull request, 2 by reference, 2 by branch name; 2 unlinked. Issue titles: from GitHub.",
    );
  });
});
