import { branchIssue, closingIssues, MERGE_PR, parseMerge, references } from "./issue-text.js";
import type { CommitMessage, ForgeData, Link } from "./issues.js";

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
