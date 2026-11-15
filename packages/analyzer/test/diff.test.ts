import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateDiffSummary } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { buildDiff, defaultBranch, diffText } from "../src/diff.js";
import { parseSize } from "../src/render.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";

const body = (n: number, extra = "") =>
  `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n${extra}`;

/** main: a.ts, b.ts, gone.ts. Branch feat/9-x: grows a.ts with a shortcut, removes gone.ts, adds new.ts. */
function repo() {
  const dir = initRepo({ "a.ts": body(3), "b.ts": body(2), "gone.ts": body(4) });
  commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
  git(dir, "checkout", "-q", "-b", "feat/9-x");
  writeFileSync(join(dir, "a.ts"), body(6, "export function f(x: any) { if (x) { return 1; } return 2; }\n"));
  rmSync(join(dir, "gone.ts"));
  writeFileSync(join(dir, "new.ts"), body(5));
  commitAt(dir, "2026-01-02T10:00:00Z", "feat: branch work (#9)");
  return dir;
}

describe("diff", () => {
  it("compares a branch with its merge-base on the default branch", async () => {
    const dir = repo();
    // main moves on after the branch started: the base stays the merge-base
    git(dir, "checkout", "-q", "main");
    writeFileSync(join(dir, "b.ts"), body(9));
    commitAt(dir, "2026-01-03T10:00:00Z", "feat: main moves on");
    git(dir, "checkout", "-q", "feat/9-x");
    const out = makeTree({});
    const { summary, manifest } = await buildDiff({ folder: dir }, out);
    expect(summary.files).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 });
    expect(summary.totals.base).toEqual({ files: 3, rloc: 9, mcc: 3 });
    expect(summary.totals.delta).toEqual({ files: 0, rloc: 5, mcc: 1 });
    expect(summary.shortcuts).toEqual({ added: 1, byKind: { any: 1 } });
    expect(summary.biggest.map((c) => `${c.status} ${c.path}`)).toEqual([
      "added new.ts",
      "modified a.ts",
      "removed gone.ts",
    ]);
    expect(summary.biggest[1]).toEqual({ path: "a.ts", status: "modified", rloc: 4, mcc: 1 });
    expect(manifest.source.mode).toBe("diff");
    expect(manifest.frames).toHaveLength(2);
    expect(existsSync(join(out, "timeline.diff.json"))).toBe(true);
  });

  it("writes a summary that validates against its published schema", async () => {
    const { summary } = await buildDiff({ folder: repo() }, makeTree({}));
    expect(validateDiffSummary(JSON.parse(JSON.stringify(summary)))).toEqual({ valid: true, errors: [] });
    expect(validateDiffSummary({ ...summary, extra: 1 }).valid).toBe(false);
    expect(validateDiffSummary({ ...summary, files: { added: -1 } }).valid).toBe(false);
  });

  it("takes an explicit base and head", async () => {
    const dir = repo();
    const { summary } = await buildDiff({ folder: dir, base: "feat/9-x", head: "main" }, makeTree({}));
    // the other way round: what going back to main would do
    expect(summary.files).toMatchObject({ added: 1, removed: 1 });
    expect(summary.shortcuts.added).toBe(-1);
    expect(summary.head.rev).toBe("main");
  });

  it("says so when the branch has no change", async () => {
    const dir = initRepo({ "a.ts": body(3) });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
    const { summary } = await buildDiff({ folder: dir }, makeTree({}));
    expect(summary.files).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 1 });
    expect(diffText(summary)).toContain("No change");
  });

  it("reads in plain text", async () => {
    const text = diffText((await buildDiff({ folder: repo() }, makeTree({}))).summary);
    expect(text).toContain("1 files added, 1 changed, 1 removed");
    expect(text).toContain("Real lines +5, complexity +1, silenced checks +1.");
    expect(text).toContain("added    new.ts  lines +5, complexity +1");
  });

  it("finds the default branch, and asks for a base when there is none", async () => {
    const dir = repo();
    expect(await defaultBranch(dir)).toBe("main");
    const odd = initRepo({ "a.ts": body(1) });
    git(odd, "checkout", "-q", "-b", "trunk");
    commitAt(odd, "2026-01-01T10:00:00Z", "feat: start");
    await expect(buildDiff({ folder: odd }, makeTree({}))).rejects.toThrow(/Pass the base/);
  });

  it("does not modify the repository", async () => {
    const dir = repo();
    const status = git(dir, "status", "--porcelain");
    const head = git(dir, "rev-parse", "HEAD");
    await buildDiff({ folder: dir }, makeTree({}));
    expect(git(dir, "status", "--porcelain")).toBe(status);
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
  });
});

describe("picture size", () => {
  it("parses WIDTHxHEIGHT and rejects anything else", () => {
    expect(parseSize("1920x1080")).toEqual([1920, 1080]);
    expect(parseSize(undefined)).toEqual([1920, 1080]);
    expect(() => parseSize("big")).toThrow(/WIDTHxHEIGHT/);
  });
});
