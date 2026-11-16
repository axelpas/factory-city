const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
const CLOSING_URL =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/gi;
const ISSUE_URL = /https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/gi;
const REFERENCE = /(?:^|[^\w&/])#(\d+)\b/g;
const GH_REFERENCE = /\bGH-(\d+)\b/gi;
export const MERGE_PR = /^Merge pull request #(\d+) from (\S+)/;
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
