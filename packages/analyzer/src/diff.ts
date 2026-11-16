import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CcJson, DiffSummary, TimelineManifest } from "@factory-city/schema";
import { summarize } from "./diff-summary.js";
import { findRepo } from "./source/git.js";
import { buildTimeline } from "./timeline.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error((stderr || err.message).trim()));
      else ok(stdout.trim());
    });
  });
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

/** The repository's default branch: what `origin` points to, else `main` or `master` when they exist. */
export async function defaultBranch(topLevel: string): Promise<string | undefined> {
  const remote = await tryGit(topLevel, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (remote) return remote;
  for (const name of ["main", "master", "origin/main", "origin/master"]) {
    if (await tryGit(topLevel, ["rev-parse", "--verify", "-q", `${name}^{commit}`])) return name;
  }
  return undefined;
}

export interface DiffOptions {
  folder: string;
  /** Default: the merge-base of the head with the default branch. */
  base?: string;
  /** Default: HEAD. */
  head?: string;
  top?: number;
}

export interface DiffResult {
  summary: DiffSummary;
  manifest: TimelineManifest;
  dataDir: string;
}

/** Compares a branch with its base: a two-frame timeline (base, head) and a summary. */
export async function buildDiff(opts: DiffOptions, dataDir: string): Promise<DiffResult> {
  const folder = resolve(opts.folder);
  const repo = await findRepo(folder);
  if (!repo?.hasCommits)
    throw new Error(`A diff needs a git repository with commits, but ${folder} is not one.`);
  const head = opts.head ?? "HEAD";
  let base = opts.base;
  if (!base) {
    const main = await defaultBranch(repo.topLevel);
    if (!main) {
      throw new Error(
        "Could not find the default branch (no origin/HEAD, main or master). Pass the base: factory-city diff <base> [head].",
      );
    }
    base = (await tryGit(repo.topLevel, ["merge-base", main, head])) ?? main;
  }
  const { manifest } = await buildTimeline(
    { folder, by: "commit", revs: [base, head], mode: "diff", offline: true },
    dataDir,
  );
  const [first, last] = manifest.frames;
  if (!first || !last) throw new Error("The diff produced no frame.");
  const read = async (snapshot: string) =>
    JSON.parse(await readFile(join(dataDir, snapshot), "utf8")) as CcJson;
  const summary = summarize(
    manifest.project,
    { rev: base, commit: first.commit, cc: await read(first.snapshot), health: first.health },
    { rev: head, commit: last.commit, cc: await read(last.snapshot), health: last.health },
    opts.top,
  );
  return { summary, manifest, dataDir };
}

export { diffText, summarize } from "./diff-summary.js";
