import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Provenance } from "../provenance.js";
import type { Step } from "../steps.js";
import { DiffReader, type FileDiff } from "./diff-reader.js";

/** The arguments of the `git log` that prints the first-parent diffs of a range, narrowed to a folder. */
function logArguments(range: string, scope: string): string[] {
  return [
    "-c",
    "core.quotePath=false",
    "log",
    "--first-parent",
    "--reverse",
    "-m",
    "-p",
    "-U0",
    "-M",
    "--no-color",
    "--no-ext-diff",
    "--format=%x01%H",
    range,
    // a folder narrows the diffs to what changed under it; steps that touched nothing there are
    // not printed, and are applied as empty steps
    ...(scope ? ["--", scope] : []),
  ];
}

/** Applies what the diffs say to a provenance, step by step, in order. */
class Applier {
  private step = -1;
  /** The next step still to begin: steps skipped by a folder narrowing are applied empty, in order. */
  private next: number;
  replayed = 0;

  constructor(
    private readonly provenance: Provenance,
    private readonly indexOf: ReadonlyMap<string, number>,
    private readonly onStep: ((index: number) => void) | undefined,
  ) {
    this.next = provenance.applied;
  }

  file(diff: FileDiff): void {
    if (this.step < 0) return;
    const { renameFrom, newPath, oldPath, deleted, hunks } = diff;
    if (renameFrom !== undefined && newPath !== undefined) this.provenance.rename(renameFrom, newPath);
    if (deleted && oldPath !== undefined) this.provenance.remove(oldPath, this.step);
    else if (newPath !== undefined && hunks.length > 0) this.provenance.applyHunks(newPath, this.step, hunks);
  }

  /** The step being read is done: tell the caller. */
  finish(): void {
    if (this.step < 0) return;
    this.onStep?.(this.step);
    this.replayed++;
  }

  begin(hash: string): void {
    this.step = this.indexOf.get(hash) ?? -1;
    if (this.step < 0) return;
    this.applyEmpty(this.step);
    this.provenance.beginStep(this.step);
    this.next = this.step + 1;
  }

  applyEmpty(until: number): void {
    for (; this.next < until; this.next++) {
      this.provenance.beginStep(this.next);
      this.onStep?.(this.next);
      this.replayed++;
    }
  }
}

/**
 * Replays the first-parent diffs of the steps not applied yet, streaming `git log -p -U0`. `onStep` is called
 * after each step is applied, so that a caller can read the metrics of the frames it needs.
 */
export async function replay(
  topLevel: string,
  provenance: Provenance,
  onStep?: (index: number) => void,
  scope = "",
): Promise<number> {
  const steps = provenance.steps;
  const from = provenance.applied;
  if (from >= steps.length) return 0;
  const tip = (steps[steps.length - 1] as Step).hash;
  const range = from === 0 ? tip : `${(steps[from - 1] as Step).hash}..${tip}`;
  const child = spawn("git", logArguments(range, scope), {
    cwd: topLevel,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  const applier = new Applier(provenance, new Map(steps.map((s, i) => [s.hash, i])), onStep);
  const reader = new DiffReader({
    commit: (hash) => {
      reader.flush();
      applier.finish();
      applier.begin(hash);
    },
    file: (diff) => applier.file(diff),
  });
  for await (const line of lines) reader.feed(line);
  reader.flush();
  applier.finish();
  applier.applyEmpty(steps.length);
  const code: number = await new Promise((done) => child.on("close", done));
  if (code !== 0) throw new Error(`git log failed: ${stderr.trim().split("\n")[0]}`);
  return applier.replayed;
}
