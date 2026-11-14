import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function makeTree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "fc-test-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
    },
  );
}

export function makeRepo(files: Record<string, string | Buffer>): string {
  const root = makeTree(files);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "initial");
  return root;
}

/** Commits everything at a given date (ISO), so that history windows are deterministic. */
export function commitAt(
  cwd: string,
  date: string,
  message: string,
  author = "Test <test@example.com>",
): string {
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      message,
      `--author=${author}`,
      `--date=${date}`,
    ],
    { cwd, env: { ...process.env, GIT_COMMITTER_DATE: date } },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

export function initRepo(files: Record<string, string | Buffer> = {}): string {
  const root = makeTree(files);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  return root;
}
