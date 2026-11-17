import { git } from "../git.js";
import type { Rev, TimelineOptions } from "./types.js";

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

/** Keeps the last commit of each calendar day (UTC). */
export function lastOfEachDay(revs: Rev[]): Rev[] {
  const byDay = new Map<string, Rev>();
  for (const rev of revs) byDay.set(new Date(rev.time * 1000).toISOString().slice(0, 10), rev);
  return [...byDay.values()];
}
