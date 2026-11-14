import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CcJson } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { authorLabel, trailerNames } from "../src/collectors/authors.js";
import { Provenance } from "../src/collectors/provenance.js";
import type { Step } from "../src/collectors/steps.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";

const CLAUDE = "\n\nCo-Authored-By: Agent One <one@example.com>";
const lines = (...l: string[]) => `${l.join("\n")}\n`;

function attrs(cc: CcJson): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const walk = (nodes: CcJson["files"], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === "File") out.set(p.replace(/^root\//, ""), cc.lenses.metrics.attributes[n.id] ?? {});
      else walk(n.children ?? [], p);
    }
  };
  walk(cc.files, "");
  return out;
}

function step(time: number, patch: Partial<Step> = {}): Step {
  return {
    hash: `h${time}`,
    parents: [],
    time: time * 86400,
    subject: "feat: x",
    body: "",
    authorName: "A",
    authorEmail: "a@example.com",
    merged: [],
    link: { strategy: "unlinked" },
    isFix: false,
    ...patch,
  };
}

describe("line provenance engine", () => {
  it("keeps, for every line, the step that wrote it", () => {
    const steps = [step(0), step(1), step(2)];
    const p = new Provenance(steps, [0, 1, 0], ["ann", "bob"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("a.ts", 0, [[0, 0, 4]]); // 4 lines by ann
    p.beginStep(1);
    p.applyHunks("a.ts", 1, [[2, 1, 3]]); // bob rewrites line 2 into 3 lines
    p.beginStep(2);
    p.applyHunks("a.ts", 2, [[6, 0, 1]]); // ann appends a line
    const m = p.fileMetrics("").get("a.ts");
    // lines: ann, bob, bob, bob, ann, ann, ann
    expect(m).toMatchObject({ main_agent: 0, main_agent_share: 4 / 7 });
  });

  it("counts a line that dies young as rework, and credits it to the step that wrote it", () => {
    const steps = [step(0), step(3), step(40)];
    const p = new Provenance(steps, [0, 0, 0], ["x"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("a.ts", 0, [[0, 0, 10]]);
    p.beginStep(1);
    p.applyHunks("a.ts", 1, [[1, 2, 2]]); // 2 lines rewritten after 3 days
    expect(p.fileMetrics("").get("a.ts")).toMatchObject({ rework_lines: 2, rework_ratio: 2 / 12 });
    expect(p.tally(0)).toMatchObject({ added: 10, reworked: 2 });
    p.beginStep(2);
    p.applyHunks("a.ts", 2, [[5, 3, 3]]); // 3 lines rewritten after 40 days: not rework
    // at day 40 the window (30 days) no longer holds the rework of day 3
    expect(p.fileMetrics("").get("a.ts")).toMatchObject({ rework_lines: 0, rework_ratio: 0 });
    expect(p.tally(0)).toMatchObject({ reworked: 2 });
  });

  it("applies several hunks of one diff, insertions and deletions included", () => {
    const steps = [step(0), step(1)];
    const p = new Provenance(steps, [0, 1], ["a", "b"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("a.ts", 0, [[0, 0, 6]]);
    p.beginStep(1);
    // insert 1 line after line 1, delete line 3, replace line 6
    p.applyHunks("a.ts", 1, [
      [1, 0, 1],
      [3, 1, 0],
      [6, 1, 1],
    ]);
    const m = p.fileMetrics("").get("a.ts");
    // 6 + 1 - 1 = 6 lines, 2 of them by b
    expect(m?.main_agent_share).toBeCloseTo(4 / 6, 10);
    expect(m?.rework_lines).toBe(2);
  });

  it("points a fix back to the steps whose lines it touched", () => {
    const steps = [step(0), step(1), step(2, { isFix: true }), step(3, { isFix: true })];
    const p = new Provenance(steps, [0, 0, 0, 0], ["x"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("a.ts", 0, [[0, 0, 3]]);
    p.beginStep(1);
    p.applyHunks("b.ts", 1, [[0, 0, 3]]);
    p.beginStep(2);
    p.applyHunks("a.ts", 2, [[1, 2, 2]]);
    p.beginStep(3);
    p.applyHunks("a.ts", 3, [[1, 1, 1]]); // touches a line written by the first fix
    expect(p.retrospective([0], 0)).toMatchObject({ caused_fixes: 1, lines_added: 3 });
    expect(p.retrospective([1], 86400).caused_fixes).toBe(0);
    // a fix does not "cause" itself
    expect(p.retrospective([2], 2 * 86400).caused_fixes).toBe(1);
  });

  it("keeps rework_after pending until the horizon has passed", () => {
    const steps = [step(0), step(3), step(20)];
    const p = new Provenance(steps, [0, 0, 0], ["x"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("a.ts", 0, [[0, 0, 10]]);
    p.beginStep(1);
    p.applyHunks("a.ts", 1, [[1, 4, 4]]);
    expect(p.retrospective([0], 0).rework_after).toBeUndefined();
    p.beginStep(2);
    expect(p.retrospective([0], 0).rework_after).toBeCloseTo(0.4, 10);
    expect(p.retrospective([2], 20 * 86400).rework_after).toBeUndefined();
  });

  it("follows a rename and forgets a deleted file", () => {
    const steps = [step(0), step(1), step(2)];
    const p = new Provenance(steps, [0, 1, 1], ["a", "b"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("old.ts", 0, [[0, 0, 5]]);
    p.applyHunks("gone.ts", 0, [[0, 0, 2]]);
    p.beginStep(1);
    p.rename("old.ts", "new.ts");
    p.beginStep(2);
    p.remove("gone.ts", 2);
    const m = p.fileMetrics("");
    expect([...m.keys()]).toEqual(["new.ts"]);
    expect(m.get("new.ts")).toMatchObject({ main_agent: 0, main_agent_share: 1 });
  });

  it("restores a saved state only when it is a prefix of the history", () => {
    const steps = [step(0), step(1)];
    const p = new Provenance(steps, [0, 1], ["a", "b"], { recentDays: 30, reworkDays: 14 });
    p.beginStep(0);
    p.applyHunks("a.ts", 0, [[0, 0, 5]]);
    const saved = JSON.parse(JSON.stringify(p.serialize()));
    const again = new Provenance(steps, [0, 1], ["a", "b"], { recentDays: 30, reworkDays: 14 });
    expect(again.restore(saved)).toBe(true);
    expect(again.applied).toBe(1);
    expect(again.fileMetrics("").get("a.ts")).toEqual(p.fileMetrics("").get("a.ts"));
    const other = new Provenance([step(9), step(10)], [0, 0], ["a"], { recentDays: 30, reworkDays: 14 });
    expect(other.restore(saved)).toBe(false);
  });
});

describe("author labels", () => {
  it("reads Co-Authored-By trailers", () => {
    expect(
      trailerNames("body\n\nCo-Authored-By: Agent One <one@example.com>\nco-authored-by: Second"),
    ).toEqual(["Agent One", "Second"]);
    expect(trailerNames("no trailer")).toEqual([]);
  });

  it("uses the trailer first, then the configured rules, else unknown", () => {
    const rules = [{ pattern: "bot@", label: "the bot" }];
    expect(
      authorLabel(
        step(0, { body: "x\n\nCo-Authored-By: Agent One <one@example.com>", authorEmail: "bot@x.org" }),
        rules,
      ),
    ).toBe("Agent One");
    expect(authorLabel(step(0, { authorEmail: "bot@x.org" }), rules)).toBe("the bot");
    expect(authorLabel(step(0), rules)).toBe("unknown");
    expect(authorLabel(step(0), [])).toBe("unknown");
  });

  it("labels a merge by the commits it brought, not by who merged", () => {
    const merged = [
      {
        hash: "m",
        subject: "work",
        body: "Co-Authored-By: Agent Two <two@example.com>",
        authorName: "Dev",
        authorEmail: "dev@x.org",
      },
    ];
    expect(authorLabel(step(0, { subject: "Merge pull request #1 from me/x", merged }), [])).toBe(
      "Agent Two",
    );
  });
});

/**
 * a.ts: 6 lines on day 1 (agent one). Day 4: lines 1-2 rewritten (3 days old: rework). Day 31: lines 5-6
 * rewritten by a second author (30 days old: not rework). Day 32: a fix touches line 3.
 */
function syntheticRepo() {
  const dir = initRepo();
  const a = (...l: string[]) =>
    writeFileSync(join(dir, "a.ts"), lines(...l.map((x) => `export const ${x} = 1;`)));
  a("a1", "a2", "a3", "a4", "a5", "a6");
  writeFileSync(
    join(dir, "b.ts"),
    lines("export const b1 = 1;", "--- not a header", "+++ nor this", "@@ -1 +1 @@ nor that"),
  );
  const c1 = commitAt(dir, "2026-01-01T10:00:00Z", `feat: start (#1)${CLAUDE}`);
  a("r1", "r2", "a3", "a4", "a5", "a6");
  const c2 = commitAt(dir, "2026-01-04T10:00:00Z", `feat: early rewrite (#2)${CLAUDE}`);
  a("r1", "r2", "a3", "a4", "late5", "late6");
  writeFileSync(
    join(dir, "b.ts"),
    lines("export const b1 = 2;", "--- still not a header", "+++ nor this", "@@ -1 +1 @@ nor that"),
  );
  const c3 = commitAt(
    dir,
    "2026-01-31T10:00:00Z",
    "feat: late rewrite (#3)\n\nCo-Authored-By: Agent Two <two@example.com>",
  );
  a("r1", "r2", "fixed3", "a4", "late5", "late6");
  const c4 = commitAt(dir, "2026-02-01T10:00:00Z", "fix: repair line three (#4)");
  return { dir, c1, c2, c3, c4 };
}

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
