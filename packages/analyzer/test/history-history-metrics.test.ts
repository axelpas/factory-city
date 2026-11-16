import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { parseLog } from "../src/collectors/history.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";
import { body, syntheticRepo, values } from "./history-helpers.js";

it("history metrics > counts commits, authors, fixes, age and recent changes at HEAD", async () => {
  const { dir } = syntheticRepo();
  const a = values(await analyze({ folder: dir })).get("src/a.ts");
  expect(a).toMatchObject({
    number_of_commits: 4,
    number_of_authors: 2,
    fix_commits: 2,
    fix_ratio: 0.5,
    // window: 30 days before 2026-03-20, so c3 and c5
    recent_commits: 2,
    fix_commits_recent: 1,
    lines_added_recent: 2,
    age_days: 78,
    days_since_last_change: 0,
  });
});

it("history metrics > never uses a commit later than the analyzed revision", async () => {
  const { dir, c2 } = syntheticRepo();
  const past = values(await analyze({ folder: dir, rev: c2 }));
  expect(past.get("src/a.ts")).toMatchObject({
    number_of_commits: 2,
    number_of_authors: 2,
    fix_commits: 1,
    // window ends at c2's own date (2026-01-10): c1 and c2 are both recent there
    recent_commits: 2,
    age_days: 9,
    days_since_last_change: 0,
  });
  expect(past.has("src/c.ts")).toBe(false);
  expect(past.get("src/b.ts")).toMatchObject({ number_of_commits: 1, days_since_last_change: 9 });
});

it("history metrics > gives the same past snapshot whatever happened afterwards", async () => {
  const { dir, c2 } = syntheticRepo();
  const before = JSON.stringify(values(await analyze({ folder: dir, rev: c2 })).get("src/a.ts"));
  writeFileSync(join(dir, "src/a.ts"), body(9));
  commitAt(dir, "2026-06-01T10:00:00Z", "fix: later change");
  const after = JSON.stringify(values(await analyze({ folder: dir, rev: c2 })).get("src/a.ts"));
  expect(after).toBe(before);
});

it("history metrics > follows renames", async () => {
  const { dir } = syntheticRepo();
  const renamed = values(await analyze({ folder: dir })).get("src/renamed.ts");
  // created in c1, renamed in c4
  expect(renamed).toMatchObject({ number_of_commits: 2, age_days: 78, days_since_last_change: 15 });
});

it("history metrics > classifies fixes by conventional type, configured pattern and fix/ branch", async () => {
  const dir = initRepo({ "a.ts": body(1), "factory-city.config.json": '{ "fixPatterns": ["^bug:"] }' });
  commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
  writeFileSync(join(dir, "a.ts"), body(2));
  commitAt(dir, "2026-01-02T10:00:00Z", "bug: wrong total");
  writeFileSync(join(dir, "a.ts"), body(3));
  commitAt(dir, "2026-01-03T10:00:00Z", "Fix typo in a comment");
  git(dir, "checkout", "-q", "-b", "fix/12-crash");
  writeFileSync(join(dir, "a.ts"), body(4));
  commitAt(dir, "2026-01-04T10:00:00Z", "handle the null case");
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
      "fix/12-crash",
      "-m",
      "Merge pull request #13 from me/fix/12-crash",
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        GIT_COMMITTER_DATE: "2026-01-05T10:00:00Z",
        GIT_AUTHOR_DATE: "2026-01-05T10:00:00Z",
      },
    },
  );
  const a = values(await analyze({ folder: dir })).get("a.ts");
  // "bug:" by pattern, the branch commit by its fix/ branch; "Fix typo" is not a conventional fix
  expect(a).toMatchObject({ number_of_commits: 4, fix_commits: 2 });
});

it("history metrics > counts files that usually change together", async () => {
  const dir = initRepo();
  for (let i = 1; i <= 4; i++) {
    writeFileSync(join(dir, "a.ts"), body(i));
    writeFileSync(join(dir, "b.ts"), body(i));
    if (i === 1) writeFileSync(join(dir, "lonely.ts"), body(1));
    commitAt(dir, `2026-01-0${i}T10:00:00Z`, `feat: step ${i}`);
  }
  const v = values(await analyze({ folder: dir }));
  expect(v.get("a.ts")?.co_change_files).toBe(1);
  expect(v.get("b.ts")?.co_change_files).toBe(1);
  expect(v.get("lonely.ts")?.co_change_files).toBe(0);
});

it("history metrics > reaches data level 1 with git and stays at 0 without, where history is unavailable, never zero", async () => {
  const { dir } = syntheticRepo();
  const withGit = await analyze({ folder: dir });
  expect(withGit.manifest.dataLevel).toBe(1);
  const plain = await analyze({ folder: makeTree({ "a.ts": body(1) }) });
  expect(plain.manifest.dataLevel).toBe(0);
  expect(values(plain).get("a.ts")).not.toHaveProperty("number_of_commits");
  expect(plain.manifest.metrics).not.toContain("recent_commits");
});

it("history metrics > leaves history out for a file that is not committed yet (--dirty)", async () => {
  const { dir } = syntheticRepo();
  writeFileSync(join(dir, "src/new.ts"), body(1));
  const v = values(await analyze({ folder: dir, dirty: true }));
  expect(v.get("src/new.ts")).not.toHaveProperty("number_of_commits");
  expect(v.get("src/a.ts")?.number_of_commits).toBe(4);
});

it("history metrics > does not modify the repository", async () => {
  const { dir } = syntheticRepo();
  const head = git(dir, "rev-parse", "HEAD");
  const status = git(dir, "status", "--porcelain");
  const refs = git(dir, "for-each-ref");
  await analyze({ folder: dir });
  expect(git(dir, "rev-parse", "HEAD")).toBe(head);
  expect(git(dir, "status", "--porcelain")).toBe(status);
  expect(git(dir, "for-each-ref")).toBe(refs);
});

it("history metrics > handles a single commit and a detached HEAD", async () => {
  const dir = initRepo({ "a.ts": body(1) });
  const c1 = commitAt(dir, "2026-01-01T10:00:00Z", "feat: only");
  expect(values(await analyze({ folder: dir })).get("a.ts")).toMatchObject({
    number_of_commits: 1,
    age_days: 0,
  });
  writeFileSync(join(dir, "a.ts"), body(2));
  commitAt(dir, "2026-01-02T10:00:00Z", "feat: two");
  git(dir, "checkout", "-q", c1);
  expect(values(await analyze({ folder: dir })).get("a.ts")?.number_of_commits).toBe(1);
});

it("history metrics > warns on a shallow clone and says how to fetch the full history", async () => {
  const { dir } = syntheticRepo();
  const clone = join(makeTree({}), "shallow");
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${dir}`, clone]);
  const result = await analyze({ folder: clone });
  expect(result.manifest.git.shallow).toBe(true);
  expect(result.manifest.warnings.join(" ")).toContain("git fetch --unshallow");
});

it("history metrics > rejects an invalid configuration with an actionable message", async () => {
  const dir = initRepo({
    "a.ts": body(1),
    "factory-city.config.json": '{ "windows": { "recentDays": -1 } }',
  });
  commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
  const result = await analyze({ folder: dir });
  expect(result.manifest.dataLevel).toBe(0);
  expect(result.manifest.warnings.join(" ")).toContain("recentDays must be a positive number");
});

it("git log parsing > reads plain changes, renames and binary files", () => {
  const log =
    "\u0001abc\u00021700000000\u0002A@X.org\u0002feat: x\u0003\u0000\n3\t1\tsrc/a.ts\u00000\t0\t\u0000old.ts\u0000new.ts\u0000-\t-\timg.png\u0000";
  const [commit] = parseLog(log);
  expect(commit).toMatchObject({ hash: "abc", time: 1700000000, author: "a@x.org", subject: "feat: x" });
  expect(commit?.changes).toEqual([
    { path: "src/a.ts", added: 3, deleted: 1 },
    { path: "new.ts", oldPath: "old.ts", added: 0, deleted: 0 },
    { path: "img.png", added: 0, deleted: 0 },
  ]);
});
