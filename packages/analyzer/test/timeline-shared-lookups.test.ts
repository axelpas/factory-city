import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { reachability, reachableCommits, shortHashes } from "../src/collectors/history.js";
import { git } from "../src/git.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, initRepo, makeTree, git as run } from "./helpers.js";
import { body, values } from "./history-helpers.js";
import { attrsByPath, read, repo } from "./timeline-helpers.js";

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

it("timeline lookups > reachable commits of a shallow clone match one rev-list per revision", async () => {
  const { dir, after } = await repoWithMerge();
  const clone = makeTree({});
  execFileSync("git", ["clone", "-q", "--depth", "2", `file://${dir}`, join(clone, "c")]);
  const there = join(clone, "c");
  const heads = (await git(there, ["rev-list", "--all"])).split("\n").filter(Boolean);
  const reach = await reachability(there, heads);
  for (const rev of heads)
    expect([...reach(rev)].sort(), rev).toEqual([...(await reachableCommits(there, rev))].sort());
  expect(heads).toContain(after);
});

it("timeline lookups > reachable commits of revisions on two branches, in no order, match one rev-list each", async () => {
  const { dir, side, main, after, root } = await repoWithMerge();
  const reach = await reachability(dir, [side, after, root, main]);
  for (const rev of [side, after, root, main])
    expect([...reach(rev)].sort(), rev).toEqual([...(await reachableCommits(dir, rev))].sort());
  expect(reach(side).size).toBe(2);
});

it("timeline lookups > revisions asked in several commands are all answered, as in one", async () => {
  const { dir, root, side, main, after } = await repoWithMerge();
  const revs = [root, side, main, after];
  const one = await reachability(dir, revs, 100);
  const split = await reachability(dir, revs, 2);
  for (const rev of revs) expect([...split(rev)].sort(), rev).toEqual([...one(rev)].sort());
  const shorts = await shortHashes(dir, revs, 3);
  expect([...shorts.keys()].sort()).toEqual([...revs].sort());
});

it("timeline lookups > a frame of a timeline has the metrics an analysis of its revision alone gives", async () => {
  const out = makeTree({});
  const folder = repo();
  const { manifest } = await buildTimeline({ folder, by: "commit" }, out);
  for (const frame of manifest.frames) {
    const alone = values(await analyze({ folder, rev: frame.commit }));
    const inTimeline = attrsByPath(read(out, frame.snapshot));
    expect([...inTimeline.keys()].sort(), frame.commit).toEqual([...alone.keys()].sort());
    for (const [path, v] of alone)
      for (const key of ["rloc", "mcc", "functions", "imports_out", "imports_in", "escape_hatches"])
        expect(inTimeline.get(path)?.[key], `${frame.commit} ${path} ${key}`).toBe(v[key]);
  }
});

it("timeline lookups > the process that reads blobs is closed when a frame fails", async () => {
  const children = () => {
    try {
      return execFileSync("pgrep", ["-P", String(process.pid), "-f", "cat-file"], {
        encoding: "utf8",
      }).trim();
    } catch (err) {
      // pgrep exits with 1 when nothing matches; any other failure means it cannot be used here
      if ((err as { status?: number }).status === 1) return "";
      return undefined;
    }
  };
  if (process.platform === "win32" || children() === undefined) return;
  const out = makeTree({});
  await expect(
    buildTimeline(
      {
        folder: repo(),
        by: "commit",
        onProgress: () => {
          throw new Error("stop here");
        },
      },
      out,
    ),
  ).rejects.toThrow("stop here");
  // the process goes away shortly after: poll instead of waiting a fixed time
  let left = children();
  for (let i = 0; i < 40 && left !== ""; i++) {
    await new Promise((done) => setTimeout(done, 50));
    left = children();
  }
  expect(left).toBe("");
});
