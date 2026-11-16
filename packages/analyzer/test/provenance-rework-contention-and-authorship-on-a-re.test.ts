import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CcJson } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";
import { attrs, CLAUDE, lines, syntheticRepo } from "./provenance-helpers.js";

describe("rework, contention and authorship on a repository", () => {
  it("counts a line rewritten after 3 days as rework, and one rewritten after 30 days as not", async () => {
    const { dir, c2, c3 } = syntheticRepo();
    const early = attrs((await analyze({ folder: dir, rev: c2 })).snapshot).get("a.ts");
    expect(early).toMatchObject({ rework_lines: 2 });
    // window at c2: 6 lines added on day 1 and 2 on day 4
    expect(early?.rework_ratio).toBeCloseTo(2 / 8, 10);
    const late = attrs((await analyze({ folder: dir, rev: c3 })).snapshot).get("a.ts");
    // at day 31 the window still holds day 4 (2 young deaths) but the late rewrite adds none
    expect(late).toMatchObject({ rework_lines: 2 });
    const head = attrs((await analyze({ folder: dir })).snapshot).get("a.ts");
    // at day 32 only the early rewrite is in the window: the late rewrite and the fix touched old lines
    expect(head?.rework_lines).toBe(2);
  });

  it("tells who wrote most of each file, with two author labels", async () => {
    const { dir } = syntheticRepo();
    const result = await analyze({ folder: dir });
    expect(result.manifest.categories.main_agent).toEqual(["Agent One", "Agent Two", "unknown"]);
    const a = attrs(result.snapshot).get("a.ts");
    // a.ts: r1 r2 (one), fixed3 (unknown), a4 (one), late5 late6 (two)
    expect(a).toMatchObject({ main_agent: 0, main_agent_share: 0.5 });
    const b = attrs(result.snapshot).get("b.ts");
    // b.ts: line 1 and 2 rewritten by two, lines 3-4 by one
    expect(b?.main_agent_share).toBe(0.5);
  });

  it("is not confused by file content that looks like diff headers", async () => {
    const { dir } = syntheticRepo();
    const b = attrs((await analyze({ folder: dir })).snapshot).get("b.ts");
    expect(b?.loc).toBe(4);
    expect(b?.main_agent).toBeDefined();
  });

  it("counts the distinct issues that touched a file recently", async () => {
    const { dir, c2 } = syntheticRepo();
    expect(attrs((await analyze({ folder: dir, rev: c2 })).snapshot).get("a.ts")?.issues_recent).toBe(2);
    // at HEAD (day 32) the window holds days 4, 31 and 32: issues 2, 3 and 4
    expect(attrs((await analyze({ folder: dir })).snapshot).get("a.ts")?.issues_recent).toBe(3);
  });

  it("keeps provenance across a rename", async () => {
    const { dir } = syntheticRepo();
    renameSync(join(dir, "a.ts"), join(dir, "moved.ts"));
    commitAt(dir, "2026-02-02T10:00:00Z", "refactor: move a");
    const moved = attrs((await analyze({ folder: dir })).snapshot).get("moved.ts");
    expect(moved).toMatchObject({ main_agent: 0, main_agent_share: 0.5 });
  });

  it("uses the configured author rules when there is no trailer", async () => {
    const dir = initRepo({
      "a.ts": lines("export const a = 1;"),
      "factory-city.config.json": '{ "authorLabels": [{ "pattern": "ann@", "label": "Ann" }] }',
    });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: start", "Ann <ann@example.com>");
    const result = await analyze({ folder: dir });
    expect(result.manifest.categories.main_agent).toEqual(["Ann"]);
    expect(attrs(result.snapshot).get("a.ts")?.main_agent).toBe(0);
  });

  it("leaves rework and authorship out without git, never zero", async () => {
    const result = await analyze({ folder: makeTree({ "a.ts": lines("export const a = 1;") }) });
    const a = attrs(result.snapshot).get("a.ts");
    expect(a).not.toHaveProperty("rework_lines");
    expect(a).not.toHaveProperty("main_agent");
    expect(result.manifest.categories).not.toHaveProperty("main_agent");
  });
});

describe("provenance in a timeline", () => {
  it("gives each frame the rework known at that frame, and the retrospective metrics afterwards", async () => {
    const { dir } = syntheticRepo();
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: dir, by: "commit" }, out);
    const read = (i: number) =>
      attrs(
        JSON.parse(readFileSync(join(out, manifest.frames[i]?.snapshot as string), "utf8")) as CcJson,
      ).get("a.ts");
    expect([0, 1, 2, 3].map((i) => read(i)?.rework_lines)).toEqual([0, 2, 2, 2]);
    // frame 1 added 6 lines of a.ts and 4 of b.ts; 2 of them were rewritten within 14 days
    expect(manifest.frames[0]?.metrics.rework_after).toBeCloseTo(2 / 10, 10);
    // a later fix touched a line of frame 1
    expect(manifest.frames[0]?.metrics.caused_fixes).toBe(1);
    // the last frames have less than 14 days of later history: pending, not zero
    expect(manifest.frames[3]?.metrics.rework_after).toBeUndefined();
    expect(manifest.frames[3]?.metrics.rework_after_pending).toBe(true);
    expect(manifest.categories.main_agent).toEqual(["Agent One", "Agent Two", "unknown"]);
  });

  it("never lets later history change the city of an earlier frame", async () => {
    const { dir } = syntheticRepo();
    const out1 = makeTree({});
    const before = await buildTimeline({ folder: dir, by: "commit" }, out1);
    const first = readFileSync(join(out1, before.manifest.frames[1]?.snapshot as string), "utf8");
    writeFileSync(join(dir, "a.ts"), lines("export const all = 1;"));
    commitAt(dir, "2026-02-03T10:00:00Z", "fix: rewrite everything (#5)");
    const out2 = makeTree({});
    const after = await buildTimeline({ folder: dir, by: "commit" }, out2);
    expect(readFileSync(join(out2, after.manifest.frames[1]?.snapshot as string), "utf8")).toBe(first);
    // only the retrospective metrics of the earlier frame moved
    expect(after.manifest.frames[0]?.metrics.caused_fixes).toBe(2);
  });

  it("replays only the new steps when a timeline is extended", async () => {
    const { dir } = syntheticRepo();
    const out = makeTree({});
    const cold = await buildTimeline({ folder: dir, by: "commit" }, out);
    expect(cold.provenance).toEqual({ replayed: 4, reused: 0 });
    writeFileSync(join(dir, "c.ts"), lines("export const c = 1;"));
    commitAt(dir, "2026-02-03T10:00:00Z", "feat: add c (#5)");
    const warm = await buildTimeline({ folder: dir, by: "commit" }, out);
    expect(warm.provenance).toEqual({ replayed: 1, reused: 4 });
    const same = await buildTimeline({ folder: dir, by: "commit" }, out);
    expect(same.provenance).toEqual({ replayed: 0, reused: 5 });
    expect(JSON.stringify(same.manifest.frames)).toBe(JSON.stringify(warm.manifest.frames));
  });

  it("labels lines brought by a merge with the merged commits' author", async () => {
    const dir = initRepo({ "a.ts": lines("export const a = 1;") });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
    git(dir, "checkout", "-q", "-b", "feat/2-x");
    writeFileSync(join(dir, "x.ts"), lines("export const x = 1;", "export const y = 2;"));
    commitAt(dir, "2026-01-02T10:00:00Z", `add x${CLAUDE}`);
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
        "feat/2-x",
        "-m",
        "Merge pull request #3 from me/feat/2-x",
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
    const result = await analyze({ folder: dir });
    const labels = result.manifest.categories.main_agent as string[];
    expect(labels[attrs(result.snapshot).get("x.ts")?.main_agent as number]).toBe("Agent One");
    expect(attrs(result.snapshot).get("x.ts")?.issues_recent).toBe(1);
  });
});
