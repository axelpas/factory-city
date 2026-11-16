import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhRunner } from "../src/collectors/forge.js";
import { loadForge } from "../src/collectors/forge.js";
import { coverageLine } from "../src/collectors/issues.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, initRepo, makeTree } from "./helpers.js";
import { replay, syntheticRepo } from "./issues-helpers.js";

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
