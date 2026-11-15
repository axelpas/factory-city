import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CcJson,
  DiffFileChange,
  DiffSummary,
  FrameHealth,
  TimelineManifest,
} from "@factory-city/schema";
import { findRepo } from "./source/git.js";
import { buildTimeline } from "./timeline.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) fail(new Error((stderr || err.message).trim()));
      else ok(stdout.trim());
    });
  });
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

/** The repository's default branch: what `origin` points to, else `main` or `master` when they exist. */
export async function defaultBranch(topLevel: string): Promise<string | undefined> {
  const remote = await tryGit(topLevel, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (remote) return remote;
  for (const name of ["main", "master", "origin/main", "origin/master"]) {
    if (await tryGit(topLevel, ["rev-parse", "--verify", "-q", `${name}^{commit}`])) return name;
  }
  return undefined;
}

export interface DiffOptions {
  folder: string;
  /** Default: the merge-base of the head with the default branch. */
  base?: string;
  /** Default: HEAD. */
  head?: string;
  top?: number;
}

export interface DiffResult {
  summary: DiffSummary;
  manifest: TimelineManifest;
  dataDir: string;
}

function attributesByPath(cc: CcJson): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const walk = (nodes: CcJson["files"], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === "File") out.set(p.replace(/^root\//, ""), cc.lenses.metrics.attributes[n.id] ?? {});
      else walk(n.children ?? [], p);
    }
  };
  walk(cc.files, "");
  return out;
}

/** What a branch does to the city, from the snapshots of its base and of its head. */
type Side = { rev: string; commit: string; cc: CcJson; health?: FrameHealth };

export function summarize(project: string, base: Side, head: Side, top = 10): DiffSummary {
  const before = attributesByPath(base.cc);
  const after = attributesByPath(head.cc);
  const changes: DiffFileChange[] = [];
  const files = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const byKind: Record<string, number> = {};
  let shortcuts = 0;
  const totals = (m: Map<string, Record<string, number>>) => {
    let rloc = 0;
    let mcc = 0;
    for (const v of m.values()) {
      rloc += v.rloc ?? 0;
      mcc += v.mcc ?? 0;
    }
    return { files: m.size, rloc, mcc };
  };
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    const rloc = (b?.rloc ?? 0) - (a?.rloc ?? 0);
    const mcc = (b?.mcc ?? 0) - (a?.mcc ?? 0);
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (!key.startsWith("escape_") || key === "escape_hatches" || key === "escape_hatch_density") continue;
      const delta = (b?.[key] ?? 0) - (a?.[key] ?? 0);
      if (delta !== 0) byKind[key.slice(7)] = (byKind[key.slice(7)] ?? 0) + delta;
    }
    shortcuts += (b?.escape_hatches ?? 0) - (a?.escape_hatches ?? 0);
    if (!a) {
      files.added++;
      changes.push({ path, status: "added", rloc, mcc });
    } else if (!b) {
      files.removed++;
      changes.push({ path, status: "removed", rloc, mcc });
    } else if (rloc !== 0 || mcc !== 0 || (a.loc ?? 0) !== (b.loc ?? 0)) {
      files.modified++;
      changes.push({ path, status: "modified", rloc, mcc });
    } else files.unchanged++;
  }
  const weight = (c: DiffFileChange) => Math.abs(c.rloc) + Math.abs(c.mcc);
  changes.sort((x, y) => weight(y) - weight(x) || (x.path < y.path ? -1 : 1));
  const tb = totals(before);
  const th = totals(after);
  return {
    kind: "diff",
    schemaVersion: 1,
    project,
    base: { rev: base.rev, commit: base.commit },
    head: { rev: head.rev, commit: head.commit },
    files,
    totals: {
      base: tb,
      head: th,
      delta: { files: th.files - tb.files, rloc: th.rloc - tb.rloc, mcc: th.mcc - tb.mcc },
    },
    shortcuts: { added: shortcuts, byKind },
    biggest: changes.slice(0, top),
    quality: {
      base: base.health?.score ?? 0,
      head: head.health?.score ?? 0,
      delta: Math.round(((head.health?.score ?? 0) - (base.health?.score ?? 0)) * 10) / 10,
    },
    hotspots: {
      created: (head.health?.hotspots ?? []).filter((p) => !(base.health?.hotspots ?? []).includes(p)),
      resolved: (base.health?.hotspots ?? []).filter((p) => !(head.health?.hotspots ?? []).includes(p)),
    },
  };
}

/** Compares a branch with its base: a two-frame timeline (base, head) and a summary. */
export async function buildDiff(opts: DiffOptions, dataDir: string): Promise<DiffResult> {
  const folder = resolve(opts.folder);
  const repo = await findRepo(folder);
  if (!repo?.hasCommits)
    throw new Error(`A diff needs a git repository with commits, but ${folder} is not one.`);
  const head = opts.head ?? "HEAD";
  let base = opts.base;
  if (!base) {
    const main = await defaultBranch(repo.topLevel);
    if (!main) {
      throw new Error(
        "Could not find the default branch (no origin/HEAD, main or master). Pass the base: factory-city diff <base> [head].",
      );
    }
    base = (await tryGit(repo.topLevel, ["merge-base", main, head])) ?? main;
  }
  const { manifest } = await buildTimeline(
    { folder, by: "commit", revs: [base, head], mode: "diff", offline: true },
    dataDir,
  );
  const [first, last] = manifest.frames;
  if (!first || !last) throw new Error("The diff produced no frame.");
  const read = async (snapshot: string) =>
    JSON.parse(await readFile(join(dataDir, snapshot), "utf8")) as CcJson;
  const summary = summarize(
    manifest.project,
    { rev: base, commit: first.commit, cc: await read(first.snapshot), health: first.health },
    { rev: head, commit: last.commit, cc: await read(last.snapshot), health: last.health },
    opts.top,
  );
  return { summary, manifest, dataDir };
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

/** The summary as a few lines of text. */
export function diffText(s: DiffSummary): string {
  if (s.base.commit === s.head.commit) return `No change: ${s.head.rev} is at its base (${s.base.commit}).`;
  const f = s.files;
  const lines = [
    `${s.head.rev} (${s.head.commit}) against ${s.base.commit}: ${f.added} files added, ${f.modified} changed, ${f.removed} removed.`,
    `Real lines ${signed(s.totals.delta.rloc)}, complexity ${signed(s.totals.delta.mcc)}, silenced checks ${signed(s.shortcuts.added)}.`,
    `Score ${s.quality.head} out of 100 (${signed(s.quality.delta)}); hotspots created: ${s.hotspots.created.length}, resolved: ${s.hotspots.resolved.length}.`,
  ];
  if (f.added + f.modified + f.removed === 0) lines.push("No source file changed.");
  for (const c of s.biggest.slice(0, 5))
    lines.push(`  ${c.status.padEnd(8)} ${c.path}  lines ${signed(c.rloc)}, complexity ${signed(c.mcc)}`);
  return lines.join("\n");
}
