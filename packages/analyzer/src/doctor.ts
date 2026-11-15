import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { findRepo } from "./source/git.js";

/** Highest data level this version collects. */
export const COLLECTED_LEVEL = 2;

export interface DoctorReport {
  folder: string;
  /** Data level an analysis of this folder reaches. */
  level: 0 | 1 | 2;
  levelName: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  /** The one action that unlocks the next level. */
  next: string;
}

function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((done) => {
    execFile(cmd, args, { cwd, encoding: "utf8", timeout: 10_000 }, (err, stdout) =>
      done({ ok: !err, out: stdout.trim() }),
    );
  });
}

export async function doctor(folder: string): Promise<DoctorReport> {
  const dir = resolve(folder);
  const checks: DoctorReport["checks"] = [];
  const gitInstalled = (await run("git", ["--version"], dir)).ok;
  const repo = gitInstalled ? await findRepo(dir) : undefined;
  checks.push({ name: "git", ok: gitInstalled, detail: gitInstalled ? "installed" : "not found on PATH" });
  checks.push({
    name: "repository",
    ok: !!repo?.hasCommits,
    detail: !repo
      ? "this folder is not in a git repository"
      : !repo.hasCommits
        ? "the repository has no commit yet"
        : repo.shallow
          ? "shallow clone: history is truncated"
          : "history available",
  });

  if (!repo?.hasCommits) {
    const next = !gitInstalled
      ? "Install git to unlock level 1 (history)."
      : !repo
        ? "Analyze a git repository (or run `git init` and commit) to unlock level 1 (history)."
        : "Make a first commit to unlock level 1 (history).";
    return { folder: dir, level: 0, levelName: "Files", checks, next };
  }

  const remote = await run("git", ["remote", "get-url", "origin"], dir);
  const onGitHub = remote.ok && /github\.com[:/]/.test(remote.out);
  checks.push({
    name: "GitHub remote",
    ok: onGitHub,
    detail: onGitHub ? "origin is on GitHub" : "no GitHub remote named origin",
  });
  const ghInstalled = (await run("gh", ["--version"], dir)).ok;
  // `gh auth token` only reads local credentials; its output is discarded
  const ghSignedIn = ghInstalled && (await run("gh", ["auth", "token"], dir)).ok;
  checks.push({
    name: "gh",
    ok: ghSignedIn,
    detail: !ghInstalled
      ? "not installed"
      : ghSignedIn
        ? "installed and signed in"
        : "installed, not signed in",
  });

  let next: string;
  if (repo.shallow) next = "Run `git fetch --unshallow` to get the full history.";
  else if (!onGitHub) next = "Level 2 (issue titles, pull requests, CI runs) needs a GitHub repository.";
  else if (!ghInstalled)
    next =
      "Install the GitHub CLI (`gh`) and sign in to unlock level 2 (issue titles, pull requests, CI runs).";
  else if (!ghSignedIn)
    next = "Run `gh auth login` to unlock level 2 (issue titles, pull requests, CI runs).";
  else {
    return {
      folder: dir,
      level: 2,
      levelName: "Forge",
      checks,
      next: "Add a facts file (agent, model, outcome, cost per issue) to unlock level 3: factory-city timeline --by issue --facts <file>.",
    };
  }
  return { folder: dir, level: 1, levelName: "History", checks, next };
}
