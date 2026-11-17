import { execFile } from "node:child_process";

/** Runs `git` in a folder and returns its output; a failure says what git said. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, maxBuffer: 1024 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
      else ok(stdout);
    });
  });
}
