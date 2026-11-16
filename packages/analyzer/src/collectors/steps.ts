import { execFile } from "node:child_process";
import type { ForgeData, Link } from "./issues.js";
import { type CommitMessage, kindOf } from "./issues.js";
import { linkStep } from "./link-step.js";

/** One step of the first-parent history: a commit, or a merge commit with the commits it brought. */
export interface Step {
  hash: string;
  parents: string[];
  time: number;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  merged: Array<CommitMessage & { authorName: string; authorEmail: string }>;
  link: Link;
  isFix: boolean;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
      else ok(stdout);
    });
  });
}

const FORMAT = "--format=%x01%H%x02%P%x02%ct%x02%an%x02%ae%x02%s%x02%b";

function parse(raw: string) {
  return raw
    .split("\u0001")
    .filter((c) => c.trim() !== "")
    .map((c) => {
      const [
        hash = "",
        parents = "",
        time = "0",
        authorName = "",
        authorEmail = "",
        subject = "",
        body = "",
      ] = c.split("\u0002");
      return {
        hash: hash.trim(),
        parents: parents.split(" ").filter(Boolean),
        time: Number(time),
        authorName,
        authorEmail,
        subject,
        body: body.trim(),
      };
    });
}

export interface StepOptions {
  forge?: ForgeData;
  issuePatterns?: readonly string[];
  fixPatterns?: readonly string[];
  /** Extra `git log` arguments that narrow the walk: `--since=...`, `--until=...`. */
  limits?: readonly string[];
}

/** The steps of a revision's first-parent history, oldest first, each linked to its issue. */
export async function loadSteps(topLevel: string, rev: string, options: StepOptions = {}): Promise<Step[]> {
  const chain = parse(
    await git(topLevel, ["log", "--first-parent", "--reverse", FORMAT, ...(options.limits ?? []), rev]),
  );
  const fixPatterns = (options.fixPatterns ?? []).map((p) => new RegExp(p, "i"));
  const steps: Step[] = [];
  for (const head of chain) {
    const [first, second] = head.parents;
    const merged = first && second ? parse(await git(topLevel, ["log", FORMAT, `${first}..${second}`])) : [];
    const link = linkStep(head, merged, options.forge, options.issuePatterns ?? []);
    const subjects = [head.subject, ...merged.map((m) => m.subject)];
    const isFix =
      subjects.some((s) => kindOf(s, undefined) === "fix" || fixPatterns.some((re) => re.test(s))) ||
      (link.branch !== undefined && /^(hot)?fix\//i.test(link.branch));
    steps.push({ ...head, merged, link, isFix });
  }
  return steps;
}
