import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { reachability, reachableCommits, shortHashes } from "../src/collectors/history.js";
import { git } from "../src/git.js";
import { commitAt, initRepo, git as run } from "./helpers.js";
import { body } from "./history-helpers.js";

/** A history with a side branch merged by a merge commit, so that reachability has a merge to step over. */
async function repoWithMerge() {
  const dir = initRepo({ "a.ts": body(1) });
  const root = commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
  run(dir, "checkout", "-q", "-b", "side");
  writeFileSync(join(dir, "b.ts"), body(2));
  const side = commitAt(dir, "2026-01-02T10:00:00Z", "feat: side");
  run(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "a.ts"), body(3));
  const main = commitAt(dir, "2026-01-03T10:00:00Z", "feat: main");
  run(
    dir,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "merge",
    "-q",
    "--no-ff",
    "-m",
    "merge side",
    "side",
  );
  writeFileSync(join(dir, "a.ts"), body(4));
  const after = commitAt(dir, "2026-01-05T10:00:00Z", "feat: after");
  return { dir, root, side, main, after };
}

it("timeline lookups > reachable commits from one rev-list match one rev-list per revision, merges included", async () => {
  const { dir, root, side, main, after } = await repoWithMerge();
  const revs = [root, side, main, after];
  const reach = await reachability(dir, revs);
  for (const rev of revs)
    expect([...reach(rev)].sort(), rev).toEqual([...(await reachableCommits(dir, rev))].sort());
  // the merge commit itself is never in the set
  expect(reach(after).size).toBe(4);
});

it("timeline lookups > short hashes from one call are the ones rev-parse --short gives", async () => {
  const { dir, root, side, main, after } = await repoWithMerge();
  const revs = [root, side, main, after];
  const shorts = await shortHashes(dir, revs);
  for (const rev of revs)
    expect(shorts.get(rev), rev).toBe((await git(dir, ["rev-parse", "--short", `${rev}^{commit}`])).trim());
});
