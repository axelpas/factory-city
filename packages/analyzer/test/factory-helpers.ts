import { execFileSync } from "node:child_process";

import { readFileSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import type { Frame } from "@factory-city/schema";

import type { GhRunner } from "../src/collectors/forge.js";

import { commitAt, git, initRepo } from "./helpers.js";

export const FIXTURES = join(import.meta.dirname, "fixtures", "gh");

export const replay: GhRunner = async (args) => {
  const file = args[0] === "issue" ? "issues.json" : args[0] === "pr" ? "pulls.json" : "runs.json";
  return readFileSync(join(FIXTURES, file), "utf8");
};

export function frame(
  index: number,
  patch: Partial<Frame> = {},
  metrics: Partial<Frame["metrics"]> = {},
): Frame {
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

export function repo(): string {
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

export const FACTS_FILE = [
  "issue;agent;model;result;minutes;cost;currency",
  "#2;agent-a;model-x;succeeded;30;2.5;CHF",
  "#3;agent-b;model-y;succeeded;10;1;CHF",
].join("\n");

export const FACTS_CONFIG = JSON.stringify({
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
