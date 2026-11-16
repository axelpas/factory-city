import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CcJson, Factory, Facts } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { addCostShares, enrichFrames } from "../src/collectors/enrich.js";
import { buildTimeline } from "../src/timeline.js";
import { FACTS_CONFIG, FACTS_FILE, frame, replay, repo } from "./factory-helpers.js";
import { makeTree } from "./helpers.js";

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
