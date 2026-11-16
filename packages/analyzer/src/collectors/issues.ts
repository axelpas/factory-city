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

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
const CLOSING_URL =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/gi;
const ISSUE_URL = /https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/gi;
const REFERENCE = /(?:^|[^\w&/])#(\d+)\b/g;
const GH_REFERENCE = /\bGH-(\d+)\b/gi;
const MERGE_PR = /^Merge pull request #(\d+) from (\S+)/;
const MERGE_BRANCH = /^Merge (?:remote-tracking )?branch '([^']+)'/;
const SQUASH_PR = /\(#(\d+)\)\s*$/;

function numbers(text: string, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(re.source, re.flags))) out.push(Number(m[1]));
  return out;
}

/** Issue numbers after a closing keyword: `closes #12`, `fixes owner/repo#12`, `resolves <issue url>`. */
export function closingIssues(text: string): number[] {
  return [...numbers(text, CLOSING), ...numbers(text, CLOSING_URL)];
}

/** Plain references: `#12`, `GH-12`, full issue URLs, and the project's own patterns. */
export function references(text: string, patterns: readonly string[] = []): number[] {
  const out = [...numbers(text, REFERENCE), ...numbers(text, GH_REFERENCE), ...numbers(text, ISSUE_URL)];
  for (const p of patterns) out.push(...numbers(text, new RegExp(p, "gi")).filter((n) => Number.isFinite(n)));
  return out;
}

/** The issue number a branch name carries: `feat/12-title`, `12-title`, `issue-12`. */
export function branchIssue(branch: string): number | undefined {
  const m = /^(?:[a-z][\w-]*\/)*(?:issue[-_/])?(\d+)(?:[-_/].*)?$/i.exec(branch);
  return m ? Number(m[1]) : undefined;
}

/** What a merge or squash subject says: the pull request number and the source branch. */
export function parseMerge(subject: string): { pullRequest?: number; branch?: string } {
  const pr = MERGE_PR.exec(subject);
  if (pr) {
    // "owner/feat/12-title": the first segment is the owner of the fork
    const from = pr[2] as string;
    return {
      pullRequest: Number(pr[1]),
      branch: from.includes("/") ? from.slice(from.indexOf("/") + 1) : from,
    };
  }
  const branch = MERGE_BRANCH.exec(subject);
  if (branch) return { branch: branch[1] };
  const squash = SQUASH_PR.exec(subject);
  if (squash) return { pullRequest: Number(squash[1]) };
  return {};
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

/** What the strategies need to know about the step. */
interface StepContext {
  messages: string[];
  merge: ReturnType<typeof parseMerge>;
  /** Whether the step is the merge of a pull request. */
  isPull: boolean;
  forge: ForgeData | undefined;
  patterns: readonly string[];
}

/** 1. Closing keywords in commit messages. */
function byClosingKeyword(c: StepContext): Link | undefined {
  for (const text of c.messages) {
    const closing = closingIssues(text)[0];
    if (closing !== undefined)
      return {
        issue: closing,
        pullRequest: c.merge.pullRequest,
        strategy: "closing-keyword",
        branch: c.merge.branch,
      };
  }
  return undefined;
}

/** 2. The pull request: the forge's closing issues, else its title, body and branch. */
function byPullRequest(c: StepContext): Link | undefined {
  const number = c.merge.pullRequest;
  if (!c.isPull || number === undefined) return undefined;
  const pull = c.forge?.pulls.get(number);
  if (!pull) return undefined;
  const text = `${pull.title}\n${pull.body}`;
  const candidates = [
    pull.closes[0],
    closingIssues(text)[0],
    references(text, c.patterns)[0],
    branchIssue(pull.branch),
  ];
  const issue = candidates.find((n) => n !== undefined && n !== number);
  return issue === undefined
    ? undefined
    : { issue, pullRequest: number, strategy: "pull-request", branch: pull.branch ?? c.merge.branch };
}

/** 3. Plain references in commit messages (the pull request's own number is not an issue). */
function byReference(c: StepContext): Link | undefined {
  for (const text of c.messages) {
    const ref = references(text, c.patterns).find((n) => !(c.isPull && n === c.merge.pullRequest));
    if (ref !== undefined)
      return {
        issue: ref,
        pullRequest: c.isPull ? c.merge.pullRequest : undefined,
        strategy: "reference",
        branch: c.merge.branch,
      };
  }
  return undefined;
}

/** 4. The branch name. */
function byBranch(c: StepContext): Link | undefined {
  const branch = c.merge.branch;
  const issue = branch ? branchIssue(branch) : undefined;
  return issue === undefined
    ? undefined
    : { issue, pullRequest: c.merge.pullRequest, strategy: "branch", branch };
}

/**
 * Links one step of the first-parent history (a commit, or a merge with the commits it brought) to an issue.
 * Strategies, in priority order: closing keywords, pull request, plain references, branch name.
 */
export function linkStep(
  head: CommitMessage,
  merged: readonly CommitMessage[],
  forge: ForgeData | undefined,
  patterns: readonly string[] = [],
): Link {
  const merge = parseMerge(head.subject);
  const isPull =
    merge.pullRequest !== undefined &&
    (MERGE_PR.test(head.subject) || forge?.pulls.has(merge.pullRequest) === true);
  const context: StepContext = {
    messages: [head, ...merged].map((c) => `${c.subject}\n${c.body}`),
    merge,
    isPull,
    forge,
    patterns,
  };
  return (
    byClosingKeyword(context) ??
    byPullRequest(context) ??
    byReference(context) ??
    byBranch(context) ?? {
      pullRequest: isPull ? merge.pullRequest : undefined,
      strategy: "unlinked",
      branch: merge.branch,
    }
  );
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
