import { execFileSync } from "node:child_process";

import { readFileSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import type { GhRunner } from "../src/collectors/forge.js";

import { commitAt, git, initRepo } from "./helpers.js";

export const FIXTURES = join(import.meta.dirname, "fixtures", "gh");

export const recorded = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** Replays recorded `gh` output: no network in tests. */

export function replay(calls: string[][] = []): GhRunner {
  return async (args) => {
    calls.push(args);
    if (args[0] === "issue") return recorded("issues.json");
    if (args[0] === "pr") return recorded("pulls.json");
    if (args[0] === "run") return recorded("runs.json");
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
}

export const msg = (subject: string, body = "") => ({ hash: "h", subject, body });

export function syntheticRepo(): string {
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
