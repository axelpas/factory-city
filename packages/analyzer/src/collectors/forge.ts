import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CiRun } from "./delivery.js";
import type { ForgeData, ForgeIssue, ForgePull } from "./issues.js";

/** Runs `gh` with arguments and returns its standard output. Tests replace it with recorded output. */
export type GhRunner = (args: string[]) => Promise<string>;

export function systemGh(cwd: string): GhRunner {
  return (args) =>
    new Promise((ok, fail) => {
      execFile(
        "gh",
        args,
        { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
        (err, stdout, stderr) => {
          if (err) fail(new Error((stderr || err.message).trim().split("\n")[0]));
          else ok(stdout);
        },
      );
    });
}

const LIMIT = "1000";
const CACHE_MINUTES = 10;
/** Bumped when the cached shape changes. */
const CACHE_VERSION = 2;

interface Cached {
  version: number;
  fetchedAt: string;
  issues: ForgeIssue[];
  pulls: ForgePull[];
  /** Absent when the repository has no CI run, or when runs could not be listed. */
  runs?: CiRun[];
}

function toData(cached: Cached): ForgeData {
  return {
    issues: new Map(cached.issues.map((i) => [i.number, i])),
    pulls: new Map(cached.pulls.map((p) => [p.number, p])),
    runs: cached.runs,
  };
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  url: string;
  createdAt?: string;
  closedAt?: string | null;
}

interface RawPull {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  url: string;
  createdAt?: string;
  mergedAt?: string | null;
  closingIssuesReferences?: Array<{ number: number }>;
}

interface RawRun {
  headBranch: string;
  headSha: string;
  conclusion: string | null;
  createdAt: string;
}

/**
 * Issues, pull requests and CI runs of the repository, in three batched `gh` calls, cached on disk for a few
 * minutes. Throws when `gh` is missing, not signed in or rate limited: the caller falls back to git data alone.
 * A repository without CI simply has no runs.
 */
export async function loadForge(run: GhRunner, cachePath: string, now = Date.now()): Promise<ForgeData> {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as Cached;
    if (cached.version === CACHE_VERSION && now - Date.parse(cached.fetchedAt) < CACHE_MINUTES * 60_000) {
      return toData(cached);
    }
  } catch {
    // no cache, or unreadable: ask gh
  }
  const list = (kind: "issue" | "pr", fields: string) =>
    run([kind, "list", "--state", "all", "--limit", LIMIT, "--json", fields]);
  const rawIssues = JSON.parse(
    await list("issue", "number,title,state,labels,url,createdAt,closedAt"),
  ) as RawIssue[];
  const rawPulls = JSON.parse(
    await list("pr", "number,title,body,headRefName,url,createdAt,mergedAt,closingIssuesReferences"),
  ) as RawPull[];
  let runs: CiRun[] | undefined;
  try {
    const rawRuns = JSON.parse(
      await run(["run", "list", "--limit", LIMIT, "--json", "headBranch,headSha,conclusion,createdAt"]),
    ) as RawRun[];
    if (rawRuns.length > 0) {
      runs = rawRuns.map((r) => ({
        branch: r.headBranch,
        sha: r.headSha,
        conclusion: (r.conclusion ?? "").toLowerCase(),
        createdAt: r.createdAt,
      }));
    }
  } catch {
    // no CI, or runs are not readable: CI metrics stay unavailable
  }
  const cached: Cached = {
    version: CACHE_VERSION,
    fetchedAt: new Date(now).toISOString(),
    issues: rawIssues.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state.toLowerCase(),
      labels: i.labels.map((l) => l.name),
      url: i.url,
      ...(i.createdAt ? { createdAt: i.createdAt } : {}),
      ...(i.closedAt ? { closedAt: i.closedAt } : {}),
    })),
    pulls: rawPulls.map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body ?? "",
      branch: p.headRefName,
      url: p.url,
      closes: (p.closingIssuesReferences ?? []).map((r) => r.number),
      ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      ...(p.mergedAt ? { mergedAt: p.mergedAt } : {}),
    })),
    ...(runs ? { runs } : {}),
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cached));
  return toData(cached);
}
