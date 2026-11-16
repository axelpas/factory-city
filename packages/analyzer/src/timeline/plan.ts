import { execFile } from "node:child_process";
import { join } from "node:path";
import type { CoverageReport, FrameKind, TimelineMode } from "@factory-city/schema";
import { loadForge, systemGh } from "../collectors/forge.js";
import {
  type CommitMessage,
  emptyCoverage,
  type ForgeData,
  frameIssue,
  kindOf,
  linkStep,
} from "../collectors/issues.js";
import type { Config } from "../config.js";
import type { Rev, TimelineOptions } from "./types.js";

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
      else ok(stdout);
    });
  });
}

const KINDS: Record<string, FrameKind> = {
  feat: "feature",
  feature: "feature",
  fix: "fix",
  hotfix: "fix",
  refactor: "refactor",
  perf: "refactor",
  chore: "chore",
  build: "chore",
  ci: "chore",
  style: "chore",
  revert: "chore",
  docs: "docs",
  doc: "docs",
  test: "test",
  tests: "test",
};

/** Kind of a step, read from the conventional-commit type of its subject. */
export function kindOfSubject(subject: string): FrameKind {
  const m = /^([a-z]+)(\([^)]*\))?!?:/i.exec(subject.trim());
  return (m && KINDS[(m[1] as string).toLowerCase()]) || "unknown";
}

/** Even sampling that always keeps the first and the last item. */
export function sample<T>(items: T[], max: number | undefined): T[] {
  if (!max || max < 2 || items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))] as T);
  return out;
}

function parseRevs(raw: string): Rev[] {
  return raw
    .split("\u0001")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [hash = "", time = "0", subject = ""] = c.split("\u0002");
      return { hash, time: Number(time), subject };
    });
}

/** The branch to name in the manifest: `HEAD` becomes the current branch, or `detached <commit>` on a detached HEAD. */
export async function branchLabel(topLevel: string, branch: string): Promise<string> {
  if (branch !== "HEAD") return branch;
  try {
    const name = (await git(topLevel, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (name && name !== "HEAD") return name;
    const commit = (await git(topLevel, ["rev-parse", "--short", "HEAD"])).trim();
    return commit ? `detached ${commit}` : "HEAD";
  } catch {
    return "HEAD";
  }
}

export async function listRevs(
  topLevel: string,
  opts: TimelineOptions,
  branch: string,
  scope = "",
): Promise<Rev[]> {
  const format = "--format=%x01%H%x02%ct%x02%s";
  if (opts.revs?.length) {
    const out: Rev[] = [];
    for (const rev of opts.revs)
      out.push(...parseRevs(await git(topLevel, ["show", "-s", format, `${rev}^{commit}`])));
    return out;
  }
  const args = ["log", "--reverse", format];
  if (!opts.allCommits) args.push("--first-parent");
  else args.push("--topo-order");
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  args.push(opts.range ?? branch);
  // a folder keeps the frames that changed it: a frame that touched nothing there shows the same city
  if (scope) args.push("--", scope);
  return parseRevs(await git(topLevel, args));
}

function parseMessages(raw: string): Array<CommitMessage & { parents: string[]; time: number }> {
  return raw
    .split("\u0001")
    .filter((c) => c.trim() !== "")
    .map((c) => {
      const [hash = "", parents = "", time = "0", subject = "", body = ""] = c.split("\u0002");
      return {
        hash: hash.trim(),
        parents: parents.split(" ").filter(Boolean),
        time: Number(time),
        subject,
        body: body.trim(),
      };
    });
}

const MESSAGE_FORMAT = "--format=%x01%H%x02%P%x02%ct%x02%s%x02%b";

/**
 * Issue mode: walks the first-parent history, links each step to an issue (specification 6.4) and returns one
 * frame per issue, at the last commit linked to it. Commits linked to no issue are grouped per day.
 */
export async function planIssueFrames(
  topLevel: string,
  opts: TimelineOptions,
  branch: string,
  forge: ForgeData | undefined,
  patterns: readonly string[],
  scope = "",
): Promise<{ revs: Rev[]; coverage: CoverageReport }> {
  const args = ["log", "--first-parent", "--reverse", MESSAGE_FORMAT];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  args.push(opts.range ?? branch);
  if (scope) args.push("--", scope);
  const chain = parseMessages(await git(topLevel, args));
  const coverage = emptyCoverage(forge !== undefined);
  const byIssue = new Map<number, { index: number; rev: Rev }>();
  const unlinkedByDay = new Map<string, { index: number; rev: Rev }>();

  for (const [index, step] of chain.entries()) {
    const [first, second] = step.parents;
    const merged =
      first && second
        ? parseMessages(await git(topLevel, ["log", MESSAGE_FORMAT, `${first}..${second}`]))
        : [];
    const link = linkStep(step, merged, forge, patterns);
    const size = 1 + merged.length;
    coverage.commits += size;
    coverage.byStrategy[link.strategy] += size;
    const subjects = [step.subject, ...merged.map((m) => m.subject)];
    if (link.issue === undefined) {
      const day = new Date(step.time * 1000).toISOString().slice(0, 10);
      unlinkedByDay.set(day, {
        index,
        rev: {
          hash: step.hash,
          time: step.time,
          subject: step.subject,
          meta: { label: `unlinked ${day}`, kind: "unknown", unlinked: true },
        },
      });
      continue;
    }
    coverage.linked += size;
    const issue = frameIssue(link.issue, link.pullRequest, forge);
    const kind =
      subjects.map((s) => kindOf(s, link.branch, issue.labels)).find((k) => k !== "unknown") ?? "unknown";
    byIssue.set(link.issue, {
      index,
      rev: {
        hash: step.hash,
        time: step.time,
        subject: step.subject,
        meta: { label: issue.title ? `#${issue.number} ${issue.title}` : `#${issue.number}`, kind, issue },
      },
    });
  }
  coverage.issues = byIssue.size;
  const frames = [...byIssue.values(), ...unlinkedByDay.values()].sort((a, b) => a.index - b.index);
  return { revs: frames.map((f) => f.rev), coverage };
}

/** Keeps the last commit of each calendar day (UTC). */
export function lastOfEachDay(revs: Rev[]): Rev[] {
  const byDay = new Map<string, Rev>();
  for (const rev of revs) byDay.set(new Date(rev.time * 1000).toISOString().slice(0, 10), rev);
  return [...byDay.values()];
}

/** The frames of a timeline, picked and sampled, and what is known about how they were found. */
export interface FramePlan {
  revs: Rev[];
  /** How many frames there were before sampling. */
  total: number;
  coverage?: CoverageReport;
  forge?: ForgeData;
  warnings: string[];
}

/** Picks the revisions that become frames, from the history, by commit, by day or by issue. */
export async function planFrames(input: {
  topLevel: string;
  folder: string;
  dataDir: string;
  opts: TimelineOptions;
  mode: TimelineMode;
  branch: string;
  /** The folder the timeline is about, from the root of the repository: "" for all of it. */
  scope: string;
  config: Config;
}): Promise<FramePlan> {
  const { topLevel, folder, dataDir, opts, mode, branch, scope, config } = input;
  const warnings: string[] = [];
  let revs: Rev[];
  let coverage: CoverageReport | undefined;
  let forge: ForgeData | undefined;
  if (mode === "issue") {
    if (!opts.offline) {
      try {
        forge = await loadForge(opts.gh ?? systemGh(folder), join(dataDir, "cache", "forge.json"));
      } catch (err) {
        warnings.push(
          `GitHub data could not be loaded (${err instanceof Error ? err.message : String(err)}): issue titles are unavailable. Issues are still found from commit messages and branch names.`,
        );
      }
    }
    const plan = await planIssueFrames(topLevel, opts, branch, forge, config.issuePatterns, scope);
    revs = plan.revs;
    coverage = plan.coverage;
  } else {
    revs = await listRevs(topLevel, opts, branch, scope);
    if (mode === "day") revs = lastOfEachDay(revs);
  }
  if (revs.length === 0) throw new Error("No commit matches the given branch, range or dates.");
  return {
    revs: sample(revs, opts.maxFrames),
    total: revs.length,
    ...(coverage ? { coverage } : {}),
    ...(forge ? { forge } : {}),
    warnings,
  };
}
