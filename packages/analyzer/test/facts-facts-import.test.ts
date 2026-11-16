import { describe, expect, it } from "vitest";
import { importFacts } from "../src/collectors/facts.js";
import { type FactsMapping, factsMapping } from "../src/config.js";

/**
 * Synthetic file with the shape of a routing log: semicolon-separated, one row per attempt or review,
 * the issue written `#42`, the estimate carried by the `type` column. Every value is made up.
 */
import { HEADER, MAPPING, NOW, text } from "./facts-helpers.js";

describe("facts import", () => {
  it("imports the log through configuration alone", () => {
    const facts = importFacts(text(), MAPPING, NOW);
    expect(facts.rows).toEqual({ read: 8, kept: 6, skipped: 1 });
    expect(facts.facts.map((f) => f.issue)).toEqual([1, 2, 3]);
    expect(facts.fields).toEqual([
      "issue",
      "date",
      "agent",
      "model",
      "outcome",
      "estimate",
      "review_blockers",
      "review_majors",
      "rework_rounds",
      "minutes",
    ]);
  });

  it("merges the rows of one issue: sums numbers, takes the last attempt's outcome, counts attempts", () => {
    const two = importFacts(text(), MAPPING, NOW).facts[1];
    expect(two).toMatchObject({
      issue: 2,
      attempts: 2,
      succeeded_attempts: 1,
      outcome: "succeeded",
      agent: "agent-b",
      model: "model-z",
      estimate: "M",
      review_blockers: 0,
      review_majors: 1,
      rework_rounds: 2,
      minutes: 81,
      date: "2026-01-08",
    });
  });

  it("tells attempts from reviews: a review adds its findings and minutes, not an attempt", () => {
    const one = importFacts(text(), MAPPING, NOW).facts[0];
    expect(one).toMatchObject({
      attempts: 1,
      succeeded_attempts: 1,
      agent: "agent-a",
      review_blockers: 1,
      review_majors: 2,
      minutes: 16,
    });
  });

  it("keeps an unsuccessful outcome as it is", () => {
    expect(importFacts(text(), MAPPING, NOW).facts[2]).toMatchObject({
      issue: 3,
      outcome: "abandoned",
      succeeded_attempts: 0,
      estimate: "L",
    });
  });

  it("leaves a field the file does not have absent, never zero", () => {
    const facts = importFacts(text(), MAPPING, NOW);
    expect(facts.fields).not.toContain("cost");
    expect(facts.fields).not.toContain("human_interventions");
    for (const f of facts.facts) {
      expect(f).not.toHaveProperty("cost");
      expect(f).not.toHaveProperty("human_interventions");
    }
  });

  it("filters rows on a column value", () => {
    const all = importFacts(text(), { ...MAPPING, filter: undefined }, NOW);
    expect(all.facts.map((f) => f.issue)).toEqual([1, 2, 3, 7]);
    const other = importFacts(text(), { ...MAPPING, filter: { column: "project", values: ["other"] } }, NOW);
    expect(other.facts.map((f) => f.issue)).toEqual([7]);
  });

  it("reads a file without a header through column positions", () => {
    const byPosition: FactsMapping = {
      ...MAPPING,
      columns: {
        date: 1,
        issue: 3,
        agent: 5,
        model: 6,
        outcome: 7,
        estimate: 4,
        review_blockers: 8,
        review_majors: 9,
        rework_rounds: 10,
        minutes: 11,
      },
      filter: { column: 2, values: ["demo"] },
      attempts: { column: 4, not: ["review"] },
    };
    const facts = importFacts(text(false), byPosition, NOW);
    expect(facts.rows.read).toBe(8);
    expect(JSON.stringify(facts.facts.map(({ tags, ...f }) => f))).toBe(
      JSON.stringify(importFacts(text(), MAPPING, NOW).facts.map(({ tags, ...f }) => f)),
    );
  });

  it("reads a file without a header through the names given in the mapping", () => {
    const facts = importFacts(text(false), { ...MAPPING, names: HEADER.split(";") }, NOW);
    expect(facts.facts[1]).toMatchObject({ issue: 2, attempts: 2, minutes: 81 });
  });

  it("maps raw values to the known outcomes", () => {
    const raw = "issue,status\n1,ok\n2,ko\n3,weird";
    const facts = importFacts(
      raw,
      {
        columns: { issue: "issue", outcome: "status" },
        values: { outcome: { ok: "succeeded", ko: "failed" } },
      },
      NOW,
    );
    expect(facts.facts.map((f) => f.outcome)).toEqual(["succeeded", "failed", undefined]);
  });

  it("keeps unknown columns as tags, to group KPIs later", () => {
    const raw = "issue,agent,team,sprint\n1,a,blue,12\n2,b,red,13";
    const facts = importFacts(raw, { columns: { issue: "issue", agent: "agent" } }, NOW);
    expect(facts.facts[0]?.tags).toEqual({ team: "blue", sprint: "12" });
    expect(facts.facts[1]?.tags).toEqual({ team: "red", sprint: "13" });
  });

  it("reads comma, tab and JSON files", () => {
    const comma = importFacts(
      'issue,agent,cost,currency\n#4,"Agent, the first",1.50,CHF',
      { columns: { issue: "issue", agent: "agent", cost: "cost", currency: "currency" } },
      NOW,
    );
    expect(comma.facts[0]).toMatchObject({ issue: 4, agent: "Agent, the first", cost: 1.5, currency: "CHF" });
    const tab = importFacts("issue\tminutes\n5\t7", { columns: { issue: "issue", minutes: "minutes" } }, NOW);
    expect(tab.facts[0]).toMatchObject({ issue: 5, minutes: 7 });
    const json = importFacts(
      '[{"n": 6, "who": "a", "eur": 2}, {"n": 6, "who": "b", "eur": 3}]',
      { columns: { issue: "n", agent: "who", cost: "eur" } },
      NOW,
    );
    expect(json.facts[0]).toMatchObject({ issue: 6, agent: "b", cost: 5, attempts: 2 });
    const wrapped = importFacts('{"rows": [{"n": 8}]}', { columns: { issue: "n" } }, NOW);
    expect(wrapped.facts[0]?.issue).toBe(8);
  });

  it("keys a row by its commit when there is no issue", () => {
    const facts = importFacts(
      "commit,agent\nabc1234,a",
      { columns: { commit: "commit", agent: "agent" } },
      NOW,
    );
    expect(facts.facts[0]).toMatchObject({ commit: "abc1234", agent: "a", attempts: 1 });
    expect(facts.facts[0]).not.toHaveProperty("issue");
  });

  it("handles an empty file", () => {
    expect(importFacts("", MAPPING, NOW).facts).toEqual([]);
    expect(importFacts(HEADER, MAPPING, NOW).rows).toEqual({ read: 0, kept: 0, skipped: 0 });
  });

  it("says which column is missing, and which exist", () => {
    expect(() =>
      importFacts("issue,agent\n1,a", { columns: { issue: "issue", model: "model" } }, NOW),
    ).toThrow(/no column named "model" \(mapped to "model"\)\. Columns found: issue, agent/);
    expect(() => importFacts("1;a", { columns: { issue: "issue" } }, NOW)).toThrow(/has no header line/);
  });
});

describe("facts mapping in the configuration", () => {
  it("accepts names and positions, and needs a key", () => {
    expect(factsMapping({ columns: { issue: 3, agent: "agent" } }, "cfg").columns.issue).toBe(3);
    expect(() => factsMapping({ columns: { agent: "agent" } }, "cfg")).toThrow(
      /must map "issue" or "commit"/,
    );
    expect(() => factsMapping({ columns: { issue: 0 } }, "cfg")).toThrow(/position starting at 1/);
    expect(() => factsMapping({ columns: { issue: 1, colour: "x" } }, "cfg")).toThrow(
      /unknown field "colour"/,
    );
    expect(() => factsMapping({}, "cfg")).toThrow(/must be an object with "columns"/);
  });
});
