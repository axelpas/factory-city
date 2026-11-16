import { describe, expect, it } from "vitest";
import {
  branchIssue,
  closingIssues,
  type ForgeData,
  kindOf,
  linkStep,
  parseMerge,
  references,
} from "../src/collectors/issues.js";
import { msg } from "./issues-helpers.js";

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
