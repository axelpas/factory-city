import { describe, expect, it } from "vitest";
import { authorLabel, trailerNames } from "../src/collectors/authors.js";
import { Provenance } from "../src/collectors/provenance.js";
import { step } from "./provenance-helpers.js";

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
