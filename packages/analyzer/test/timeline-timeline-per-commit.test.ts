import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateCcJson } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { buildTimeline, sample } from "../src/timeline.js";
import { commitAt, git, initRepo, makeTree } from "./helpers.js";
import { attrsByPath, body, read, repo } from "./timeline-helpers.js";

describe("timeline per commit", () => {
  it("writes one valid snapshot per commit, in order, with what each frame changed", async () => {
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: repo(), by: "commit" }, out);
    expect(manifest.frames.map((f) => f.subject)).toEqual([
      "feat: start",
      "feat(core): add b",
      "fix: repair a",
      "refactor: replace b by c",
    ]);
    expect(manifest.frames.map((f) => f.kind)).toEqual(["feature", "feature", "fix", "refactor"]);
    for (const frame of manifest.frames) expect(validateCcJson(read(out, frame.snapshot)).valid).toBe(true);
    expect(manifest.frames[1]).toMatchObject({ added: ["src/b.ts"], modified: [], deleted: [] });
    expect(manifest.frames[2]).toMatchObject({ added: [], modified: ["src/a.ts"], deleted: [] });
    expect(manifest.frames[3]).toMatchObject({ added: ["src/c.ts"], deleted: ["src/b.ts"] });
    expect(manifest.frames[2]?.metrics).toMatchObject({
      files_touched: 1,
      lines_added: 3,
      lines_deleted: 0,
      folders_touched: 1,
    });
    expect(manifest.frames[2]?.lines).toEqual({ "src/a.ts": [3, 0] });
    expect(manifest.frames[3]?.lines).toEqual({ "src/b.ts": [0, 3], "src/c.ts": [1, 0] });
    expect(existsSync(join(out, "timeline.commit.json"))).toBe(true);
    expect(manifest.frames[3]?.totals).toEqual({ files: 2, rloc: 6, mcc: 2 });
    expect(manifest.dataLevel).toBe(1);
  });

  it("gives each frame the history up to that frame only", async () => {
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: repo(), by: "commit" }, out);
    const commitsOfA = manifest.frames.map(
      (f) => attrsByPath(read(out, f.snapshot)).get("src/a.ts")?.number_of_commits,
    );
    expect(commitsOfA).toEqual([1, 1, 2, 2]);
    const fixes = manifest.frames.map((f) => attrsByPath(read(out, f.snapshot)).get("src/a.ts")?.fix_commits);
    expect(fixes).toEqual([0, 0, 1, 1]);
    const age = manifest.frames.map((f) => attrsByPath(read(out, f.snapshot)).get("src/a.ts")?.age_days);
    expect(age).toEqual([0, 0, 1, 3]);
  });

  it("keeps the same id for a file across frames", async () => {
    const out = makeTree({});
    const { manifest } = await buildTimeline({ folder: repo(), by: "commit" }, out);
    const idOfA = manifest.frames.map((f) => {
      const src = read(out, f.snapshot).files[0]?.children?.find((c) => c.name === "src");
      return src?.children?.find((c) => c.name === "a.ts")?.id;
    });
    expect(new Set(idOfA).size).toBe(1);
  });

  it("parses each unique content once and reuses the cache on a second run", async () => {
    const dir = repo();
    const out = makeTree({});
    const cold = await buildTimeline({ folder: dir, by: "commit" }, out);
    // a.ts (2 versions), b.ts, c.ts
    expect(cold.cache.parsed).toBe(4);
    expect(existsSync(join(out, "cache", "files.json"))).toBe(true);
    const warm = await buildTimeline({ folder: dir, by: "commit" }, out);
    expect(warm.cache.parsed).toBe(0);
    expect(JSON.stringify(warm.manifest.frames)).toBe(JSON.stringify(cold.manifest.frames));
  });

  it("does not modify the repository", async () => {
    const dir = repo();
    const head = git(dir, "rev-parse", "HEAD");
    const status = git(dir, "status", "--porcelain");
    await buildTimeline({ folder: dir, by: "commit" }, makeTree({}));
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(dir, "status", "--porcelain")).toBe(status);
    expect(git(dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });
});

describe("frame selection", () => {
  it("makes one frame per calendar day with --by day", async () => {
    const { manifest } = await buildTimeline({ folder: repo(), by: "day" }, makeTree({}));
    expect(manifest.frames.map((f) => f.label)).toEqual(["2026-01-01", "2026-01-02", "2026-01-04"]);
    expect(manifest.frames[0]?.subject).toBe("feat(core): add b");
    expect(manifest.frames[0]?.totals.files).toBe(2);
  });

  it("names the branch checked out in the manifest, not the word HEAD", async () => {
    const dir = repo();
    git(dir, "checkout", "-q", "-b", "feat/12-demo");
    const named = await buildTimeline({ folder: dir, by: "commit" }, makeTree({}));
    expect(named.manifest.source.branch).toBe("feat/12-demo");
    // a detached HEAD says so, with the commit
    git(dir, "checkout", "-q", "--detach");
    const detached = await buildTimeline({ folder: dir, by: "commit" }, makeTree({}));
    expect(detached.manifest.source.branch).toMatch(/^detached [0-9a-f]{7,}$/);
    // an explicit branch is kept as it is
    const explicit = await buildTimeline({ folder: dir, by: "commit", branch: "feat/12-demo" }, makeTree({}));
    expect(explicit.manifest.source.branch).toBe("feat/12-demo");
  });

  it("takes an explicit list of revisions", async () => {
    const dir = repo();
    const first = git(dir, "rev-list", "--max-parents=0", "HEAD").trim();
    const { manifest } = await buildTimeline(
      { folder: dir, by: "commit", revs: [first, "HEAD"] },
      makeTree({}),
    );
    expect(manifest.frames.map((f) => f.subject)).toEqual(["feat: start", "refactor: replace b by c"]);
    expect(manifest.source.mode).toBe("revs");
  });

  it("limits by date and by range", async () => {
    const dir = repo();
    const since = await buildTimeline(
      { folder: dir, by: "commit", since: "2026-01-02T00:00:00Z" },
      makeTree({}),
    );
    expect(since.manifest.frames).toHaveLength(2);
    const range = await buildTimeline({ folder: dir, by: "commit", range: "HEAD~2..HEAD" }, makeTree({}));
    expect(range.manifest.frames.map((f) => f.subject)).toEqual([
      "fix: repair a",
      "refactor: replace b by c",
    ]);
  });

  it("samples evenly and keeps the first and the last frame", async () => {
    const { manifest } = await buildTimeline({ folder: repo(), by: "commit", maxFrames: 2 }, makeTree({}));
    expect(manifest.frames.map((f) => f.subject)).toEqual(["feat: start", "refactor: replace b by c"]);
    expect(manifest.source.sampledFrom).toBe(4);
    expect(sample([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    expect(sample([1, 2], 5)).toEqual([1, 2]);
  });

  it("follows the first-parent history by default and every commit on demand", async () => {
    const dir = repo();
    git(dir, "checkout", "-q", "-b", "feat/x");
    writeFileSync(join(dir, "src/x.ts"), body(1));
    commitAt(dir, "2026-01-05T10:00:00Z", "feat: x part 1");
    writeFileSync(join(dir, "src/x.ts"), body(2));
    commitAt(dir, "2026-01-05T11:00:00Z", "feat: x part 2");
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
        "feat/x",
        "-m",
        "Merge pull request #7 from me/feat/x",
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          GIT_COMMITTER_DATE: "2026-01-06T10:00:00Z",
          GIT_AUTHOR_DATE: "2026-01-06T10:00:00Z",
        },
      },
    );
    const firstParent = await buildTimeline({ folder: dir, by: "commit" }, makeTree({}));
    expect(firstParent.manifest.frames).toHaveLength(5);
    expect(firstParent.manifest.frames[4]?.commits).toHaveLength(2);
    expect(firstParent.manifest.frames[4]?.added).toEqual(["src/x.ts"]);
    const all = await buildTimeline({ folder: dir, by: "commit", allCommits: true }, makeTree({}));
    expect(all.manifest.frames).toHaveLength(7);
  });

  it("handles a single commit", async () => {
    const dir = initRepo({ "a.ts": body(1) });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: only");
    const { manifest } = await buildTimeline({ folder: dir, by: "commit" }, makeTree({}));
    expect(manifest.frames).toHaveLength(1);
  });

  it("explains that a timeline needs git", async () => {
    await expect(
      buildTimeline({ folder: makeTree({ "a.ts": body(1) }), by: "commit" }, makeTree({})),
    ).rejects.toThrow(/needs a git repository/);
  });
});
