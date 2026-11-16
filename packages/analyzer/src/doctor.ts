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

type Check = DoctorReport["checks"][number];

function repositoryDetail(repo: Awaited<ReturnType<typeof findRepo>>): string {
  if (!repo) return "this folder is not in a git repository";
  if (!repo.hasCommits) return "the repository has no commit yet";
  return repo.shallow ? "shallow clone: history is truncated" : "history available";
}

/** The step that unlocks level 1 when there is no usable history. */
function nextForHistory(gitInstalled: boolean, repo: unknown): string {
  if (!gitInstalled) return "Install git to unlock level 1 (history).";
  if (!repo) return "Analyze a git repository (or run `git init` and commit) to unlock level 1 (history).";
  return "Make a first commit to unlock level 1 (history).";
}

const LEVEL_2 = "level 2 (issue titles, pull requests, CI runs)";

/** The step that unlocks level 2, or nothing when it is reached. */
function nextForForge(shallow: boolean, onGitHub: boolean, ghInstalled: boolean, ghSignedIn: boolean) {
  if (shallow) return "Run `git fetch --unshallow` to get the full history.";
  if (!onGitHub) return "Level 2 (issue titles, pull requests, CI runs) needs a GitHub repository.";
  if (!ghInstalled) return `Install the GitHub CLI (\`gh\`) and sign in to unlock ${LEVEL_2}.`;
  if (!ghSignedIn) return `Run \`gh auth login\` to unlock ${LEVEL_2}.`;
  return undefined;
}

function ghDetail(installed: boolean, signedIn: boolean): string {
  if (!installed) return "not installed";
  return signedIn ? "installed and signed in" : "installed, not signed in";
}

/** The checks about GitHub: the remote and the `gh` tool. */
async function forgeChecks(dir: string) {
  const remote = await run("git", ["remote", "get-url", "origin"], dir);
  const onGitHub = remote.ok && /github\.com[:/]/.test(remote.out);
  const ghInstalled = (await run("gh", ["--version"], dir)).ok;
  // `gh auth token` only reads local credentials; its output is discarded
  const ghSignedIn = ghInstalled && (await run("gh", ["auth", "token"], dir)).ok;
  const checks: Check[] = [
    {
      name: "GitHub remote",
      ok: onGitHub,
      detail: onGitHub ? "origin is on GitHub" : "no GitHub remote named origin",
    },
    { name: "gh", ok: ghSignedIn, detail: ghDetail(ghInstalled, ghSignedIn) },
  ];
  return { checks, onGitHub, ghInstalled, ghSignedIn };
}

export async function doctor(folder: string): Promise<DoctorReport> {
  const dir = resolve(folder);
  const gitInstalled = (await run("git", ["--version"], dir)).ok;
  const repo = gitInstalled ? await findRepo(dir) : undefined;
  const checks: Check[] = [
    { name: "git", ok: gitInstalled, detail: gitInstalled ? "installed" : "not found on PATH" },
    { name: "repository", ok: !!repo?.hasCommits, detail: repositoryDetail(repo) },
  ];
  if (!repo?.hasCommits) {
    return { folder: dir, level: 0, levelName: "Files", checks, next: nextForHistory(gitInstalled, repo) };
  }
  const forge = await forgeChecks(dir);
  checks.push(...forge.checks);
  const next = nextForForge(repo.shallow, forge.onGitHub, forge.ghInstalled, forge.ghSignedIn);
  if (next === undefined) {
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
