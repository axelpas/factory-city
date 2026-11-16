import type { CoverageReport } from "@factory-city/schema";
import {
  type CommitMessage,
  emptyCoverage,
  type ForgeData,
  frameIssue,
  kindOf,
} from "../collectors/issues.js";
import { linkStep } from "../collectors/link-step.js";
import { git } from "./revs.js";
import type { Rev, TimelineOptions } from "./types.js";

type Message = CommitMessage & { parents: string[]; time: number };

function parseMessages(raw: string): Message[] {
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

/** One step of the history, linked to an issue or not, with the frame it would give. */
interface Planned {
  index: number;
  rev: Rev;
  /** The issue the step is linked to; none for a step grouped by day. */
  issue?: number;
}

/** The frame of one step: at the last commit linked to the issue, or grouped per day when unlinked. */
function frameOfStep(
  index: number,
  step: Message,
  merged: readonly Message[],
  link: ReturnType<typeof linkStep>,
  forge: ForgeData | undefined,
): Planned {
  const base = { hash: step.hash, time: step.time, subject: step.subject };
  if (link.issue === undefined) {
    const day = new Date(step.time * 1000).toISOString().slice(0, 10);
    return { index, rev: { ...base, meta: { label: `unlinked ${day}`, kind: "unknown", unlinked: true } } };
  }
  const issue = frameIssue(link.issue, link.pullRequest, forge);
  const subjects = [step.subject, ...merged.map((m) => m.subject)];
  const kind =
    subjects.map((s) => kindOf(s, link.branch, issue.labels)).find((k) => k !== "unknown") ?? "unknown";
  const label = issue.title ? `#${issue.number} ${issue.title}` : `#${issue.number}`;
  return { index, issue: link.issue, rev: { ...base, meta: { label, kind, issue } } };
}

/** The steps merged by a merge commit: the commits between its two parents. */
async function mergedBy(topLevel: string, step: Message): Promise<Message[]> {
  const [first, second] = step.parents;
  if (!first || !second) return [];
  return parseMessages(await git(topLevel, ["log", MESSAGE_FORMAT, `${first}..${second}`]));
}

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
  const byIssue = new Map<number, Planned>();
  const unlinkedByDay = new Map<string, Planned>();
  for (const [index, step] of chain.entries()) {
    const merged = await mergedBy(topLevel, step);
    const link = linkStep(step, merged, forge, patterns);
    const size = 1 + merged.length;
    coverage.commits += size;
    coverage.byStrategy[link.strategy] += size;
    const planned = frameOfStep(index, step, merged, link, forge);
    if (planned.issue === undefined) {
      unlinkedByDay.set(new Date(step.time * 1000).toISOString().slice(0, 10), planned);
    } else {
      coverage.linked += size;
      byIssue.set(planned.issue, planned);
    }
  }
  coverage.issues = byIssue.size;
  const frames = [...byIssue.values(), ...unlinkedByDay.values()].sort((a, b) => a.index - b.index);
  return { revs: frames.map((f) => f.rev), coverage };
}
