import type { CoverageReport, FrameIssue, FrameKind, LinkStrategy } from "@factory-city/schema";
import type { CiRun } from "./delivery.js";

/** A commit as the resolver sees it. */
export interface CommitMessage {
  hash: string;
  subject: string;
  body: string;
}

export interface ForgeIssue {
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  createdAt?: string;
  closedAt?: string;
}

export interface ForgePull {
  number: number;
  title: string;
  body: string;
  branch: string;
  url: string;
  /** Issues the pull request closes, as the forge reports them. */
  closes: number[];
  createdAt?: string;
  mergedAt?: string;
}

/** What the forge knows, when `gh` is available: issues and pull requests by number. */
export interface ForgeData {
  issues: Map<number, ForgeIssue>;
  pulls: Map<number, ForgePull>;
  /** CI runs; absent when the repository has none. */
  runs?: CiRun[];
}

export interface Link {
  issue?: number;
  pullRequest?: number;
  strategy: LinkStrategy;
  /** Branch the work came from, when a merge commit names it. */
  branch?: string;
}

const KIND_WORDS: Record<string, FrameKind> = {
  feat: "feature",
  feature: "feature",
  enhancement: "feature",
  fix: "fix",
  hotfix: "fix",
  bug: "fix",
  bugfix: "fix",
  refactor: "refactor",
  perf: "refactor",
  chore: "chore",
  build: "chore",
  ci: "chore",
  docs: "docs",
  doc: "docs",
  documentation: "docs",
  test: "test",
  tests: "test",
};

/** Kind of a step: issue labels first (level 2), then the conventional type, then the branch prefix. */
export function kindOf(
  subject: string,
  branch: string | undefined,
  labels: readonly string[] = [],
): FrameKind {
  for (const label of labels) {
    const word = label.toLowerCase().replace(/^(type|kind)[:/]\s*/, "");
    const kind = KIND_WORDS[word];
    if (kind) return kind;
  }
  const conventional = /^([a-z]+)(\([^)]*\))?!?:/i.exec(subject.trim());
  const byType = conventional ? KIND_WORDS[(conventional[1] as string).toLowerCase()] : undefined;
  if (byType) return byType;
  const prefix = branch ? /^([a-z]+)\//i.exec(branch) : null;
  return (prefix && KIND_WORDS[(prefix[1] as string).toLowerCase()]) || "unknown";
}

export function emptyCoverage(forge: boolean): CoverageReport {
  return {
    commits: 0,
    linked: 0,
    byStrategy: { "closing-keyword": 0, "pull-request": 0, reference: 0, branch: 0, unlinked: 0 },
    issues: 0,
    forge,
  };
}

/** The issue of a frame, with what the forge knows about it. */
export function frameIssue(
  number: number,
  pullRequest: number | undefined,
  forge: ForgeData | undefined,
): FrameIssue {
  const known = forge?.issues.get(number);
  const issue: FrameIssue = { number };
  if (known) {
    issue.title = known.title;
    issue.state = known.state;
    issue.labels = known.labels;
    issue.url = known.url;
  }
  if (pullRequest !== undefined) issue.pullRequest = pullRequest;
  return issue;
}

/** One line a human can read: how many commits each strategy linked. */
export function coverageLine(c: CoverageReport): string {
  const share = c.commits === 0 ? 0 : Math.round((c.linked / c.commits) * 100);
  const s = c.byStrategy;
  return `Linked ${c.linked} of ${c.commits} commits (${share}%) to ${c.issues} issues: ${s["closing-keyword"]} by closing keyword, ${s["pull-request"]} by pull request, ${s.reference} by reference, ${s.branch} by branch name; ${s.unlinked} unlinked. Issue titles: ${c.forge ? "from GitHub" : "not loaded"}.`;
}

export { branchIssue, closingIssues, parseMerge, references } from "./issue-text.js";
export { linkStep } from "./link-step.js";
