import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

interface Cached {
  fetchedAt: string;
  issues: ForgeIssue[];
  pulls: ForgePull[];
}

function toData(cached: Cached): ForgeData {
  return {
    issues: new Map(cached.issues.map((i) => [i.number, i])),
    pulls: new Map(cached.pulls.map((p) => [p.number, p])),
  };
}

/**
 * Issues and pull requests of the repository, in two batched `gh` calls, cached on disk for a few minutes.
 * Throws when `gh` is missing, not signed in or rate limited: the caller falls back to git data alone.
 */
export async function loadForge(run: GhRunner, cachePath: string, now = Date.now()): Promise<ForgeData> {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as Cached;
    if (now - Date.parse(cached.fetchedAt) < CACHE_MINUTES * 60_000) return toData(cached);
  } catch {
    // no cache, or unreadable: ask gh
  }
  const rawIssues = JSON.parse(
    await run([
      "issue",
      "list",
      "--state",
      "all",
      "--limit",
      LIMIT,
      "--json",
      "number,title,state,labels,url",
    ]),
  ) as Array<{
    number: number;
    title: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
  }>;
  const rawPulls = JSON.parse(
    await run([
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      LIMIT,
      "--json",
      "number,title,body,headRefName,url,closingIssuesReferences",
    ]),
  ) as Array<{
    number: number;
    title: string;
    body: string;
    headRefName: string;
    url: string;
    closingIssuesReferences?: Array<{ number: number }>;
  }>;
  const cached: Cached = {
    fetchedAt: new Date(now).toISOString(),
    issues: rawIssues.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state.toLowerCase(),
      labels: i.labels.map((l) => l.name),
      url: i.url,
    })),
    pulls: rawPulls.map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body ?? "",
      branch: p.headRefName,
      url: p.url,
      closes: (p.closingIssuesReferences ?? []).map((r) => r.number),
    })),
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cached));
  return toData(cached);
}
