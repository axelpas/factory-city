import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Step } from "./steps.js";

const DAY = 86400;

/** What happened to one file at one step: lines added, and fresh lines thrown away. */
interface FileEvent {
  step: number;
  added: number;
  /** Lines deleted or rewritten at this step while younger than the rework horizon. */
  young: number;
}

interface FileState {
  /** For each current line, the index of the step that wrote it. */
  origins: number[];
  events: FileEvent[];
}

/** Per-step tallies that later steps keep updating: the retrospective side of provenance. */
interface StepTally {
  added: number;
  /** Lines this step added that were deleted or rewritten within the rework horizon. */
  reworked: number;
  /** Indices of later fix steps that touched lines this step introduced. */
  fixes: number[];
  /** Lines this step added that died within 30 and within 90 days. */
  dead30: number;
  dead90: number;
}

export interface ProvenanceOptions {
  recentDays: number;
  reworkDays: number;
}

export interface FileProvenance {
  rework_lines: number;
  rework_ratio: number;
  issues_recent: number;
  main_agent: number;
  main_agent_share: number;
}

interface SerializedState {
  hashes: string[];
  tallies: StepTally[];
  files: Array<[string, { runs: number[]; events: FileEvent[] }]>;
}

/**
 * Line provenance: one replay of the first-parent diffs, keeping for every line of every file the step that
 * wrote it. Rework, contention, authorship and the retrospective metrics all read from it, so there is no
 * `git blame` per commit.
 */
export class Provenance {
  private readonly files = new Map<string, FileState>();
  private readonly tallies: StepTally[] = [];
  /** Number of steps applied so far. */
  applied = 0;

  constructor(
    readonly steps: readonly Step[],
    /** Author label of each step, as an index in `labels`. */
    readonly labelOf: readonly number[],
    readonly labels: readonly string[],
    private readonly options: ProvenanceOptions,
  ) {}

  private file(path: string): FileState {
    let f = this.files.get(path);
    if (!f) {
      f = { origins: [], events: [] };
      this.files.set(path, f);
    }
    return f;
  }

  private event(file: FileState, step: number): FileEvent {
    const last = file.events[file.events.length - 1];
    if (last && last.step === step) return last;
    const e = { step, added: 0, young: 0 };
    file.events.push(e);
    return e;
  }

  rename(from: string, to: string): void {
    const f = this.files.get(from);
    if (!f) return;
    this.files.delete(from);
    this.files.set(to, f);
  }

  remove(path: string, step: number): void {
    const f = this.files.get(path);
    if (!f) return;
    this.applyHunks(path, step, [[1, f.origins.length, 0]]);
    this.files.delete(path);
  }

  /** Applies the hunks of one file at one step. A hunk is `[oldStart, oldCount, newCount]`, ascending. */
  applyHunks(path: string, step: number, hunks: ReadonlyArray<readonly [number, number, number]>): void {
    const file = this.file(path);
    const tally = this.tallies[step] as StepTally;
    const now = (this.steps[step] as Step).time;
    const isFix = (this.steps[step] as Step).isFix;
    const horizon = this.options.reworkDays * DAY;
    // bottom-up, so that earlier line numbers stay valid
    for (let h = hunks.length - 1; h >= 0; h--) {
      const [oldStart, oldCount, newCount] = hunks[h] as readonly [number, number, number];
      const at = oldCount === 0 ? oldStart : oldStart - 1;
      const fresh = new Array<number>(newCount).fill(step);
      const removed = file.origins.splice(Math.min(Math.max(at, 0), file.origins.length), oldCount, ...fresh);
      const event = this.event(file, step);
      event.added += newCount;
      tally.added += newCount;
      for (const born of removed) {
        if (born === step) continue;
        const bornTally = this.tallies[born];
        if (!bornTally) continue;
        const age = now - (this.steps[born] as Step).time;
        if (age < horizon) {
          event.young++;
          bornTally.reworked++;
        }
        if (age < 30 * DAY) bornTally.dead30++;
        if (age < 90 * DAY) bornTally.dead90++;
        if (isFix && bornTally.fixes[bornTally.fixes.length - 1] !== step) bornTally.fixes.push(step);
      }
    }
  }

  beginStep(step: number): void {
    this.tallies[step] = { added: 0, reworked: 0, fixes: [], dead30: 0, dead90: 0 };
    this.applied = step + 1;
  }

  /** Metrics of every file as of the last applied step: history up to that step only. */
  fileMetrics(prefix: string): Map<string, FileProvenance> {
    const out = new Map<string, FileProvenance>();
    const last = this.applied - 1;
    if (last < 0) return out;
    const now = (this.steps[last] as Step).time;
    const windowStart = now - this.options.recentDays * DAY;
    const cut = prefix ? prefix.length + 1 : 0;
    for (const [path, file] of this.files) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue;
      if (file.origins.length === 0 && file.events.length === 0) continue;
      let rework = 0;
      let added = 0;
      const issues = new Set<number>();
      for (let i = file.events.length - 1; i >= 0; i--) {
        const e = file.events[i] as FileEvent;
        const step = this.steps[e.step] as Step;
        if (step.time < windowStart) break;
        rework += e.young;
        added += e.added;
        if (step.link.issue !== undefined) issues.add(step.link.issue);
      }
      const counts = new Map<number, number>();
      for (const origin of file.origins) {
        const label = this.labelOf[origin] as number;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      let main = -1;
      let best = 0;
      for (const [label, n] of counts) {
        if (n > best || (n === best && label < main)) {
          main = label;
          best = n;
        }
      }
      const metrics: FileProvenance = {
        rework_lines: rework,
        rework_ratio: rework === 0 ? 0 : rework / Math.max(rework, added),
        issues_recent: issues.size,
        main_agent: main,
        main_agent_share: file.origins.length === 0 ? 0 : best / file.origins.length,
      };
      out.set(path.slice(cut), metrics);
    }
    return out;
  }

  /**
   * Retrospective metrics of a group of steps (one frame): what later happened to the lines they added.
   * `rework_after` is pending (undefined) until the rework horizon has passed since the frame.
   */
  retrospective(
    stepIndices: readonly number[],
    frameTime: number,
  ): {
    rework_after?: number;
    caused_fixes: number;
    lines_added: number;
    alive_30?: number;
    alive_90?: number;
  } {
    const last = this.applied - 1;
    const tipTime = last >= 0 ? (this.steps[last] as Step).time : frameTime;
    let added = 0;
    let reworked = 0;
    let dead30 = 0;
    let dead90 = 0;
    const fixes = new Set<number>();
    for (const i of stepIndices) {
      const t = this.tallies[i];
      if (!t) continue;
      added += t.added;
      reworked += t.reworked;
      dead30 += t.dead30;
      dead90 += t.dead90;
      for (const f of t.fixes) if (!stepIndices.includes(f)) fixes.add(f);
    }
    const settled = tipTime - frameTime >= this.options.reworkDays * DAY;
    return {
      ...(settled && added > 0 ? { rework_after: reworked / added } : {}),
      // shelf life: known only once 30 and 90 days of later history exist
      ...(added > 0 && tipTime - frameTime >= 30 * DAY ? { alive_30: 1 - dead30 / added } : {}),
      ...(added > 0 && tipTime - frameTime >= 90 * DAY ? { alive_90: 1 - dead90 / added } : {}),
      caused_fixes: fixes.size,
      lines_added: added,
    };
  }

  /** Lines added by all steps, and how many of them were thrown away within the horizon. */
  tally(step: number): StepTally | undefined {
    return this.tallies[step];
  }

  serialize(): SerializedState {
    const files: SerializedState["files"] = [];
    for (const [path, f] of this.files) {
      // run-length encoding: [origin, count, origin, count, ...]
      const runs: number[] = [];
      for (const o of f.origins) {
        if (runs.length > 0 && runs[runs.length - 2] === o) (runs[runs.length - 1] as number)++;
        else runs.push(o, 1);
      }
      files.push([path, { runs, events: f.events }]);
    }
    return {
      hashes: this.steps.slice(0, this.applied).map((s) => s.hash),
      tallies: this.tallies.slice(0, this.applied),
      files,
    };
  }

  /** Restores a saved state when it is a prefix of this history. Returns false when it does not match. */
  restore(state: SerializedState): boolean {
    if (state.hashes.length > this.steps.length) return false;
    for (let i = 0; i < state.hashes.length; i++) if (state.hashes[i] !== this.steps[i]?.hash) return false;
    this.files.clear();
    for (const [path, f] of state.files) {
      const origins: number[] = [];
      for (let i = 0; i < f.runs.length; i += 2) {
        const origin = f.runs[i] as number;
        for (let k = 0; k < (f.runs[i + 1] as number); k++) origins.push(origin);
      }
      this.files.set(path, { origins, events: f.events });
    }
    this.tallies.length = 0;
    this.tallies.push(...state.tallies);
    this.applied = state.hashes.length;
    return true;
  }
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function unquote(path: string): string {
  const p = path.replace(/\t$/, "");
  if (!p.startsWith('"')) return p;
  try {
    return JSON.parse(p) as string;
  } catch {
    return p.slice(1, -1);
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
): Promise<number> {
  const steps = provenance.steps;
  const from = provenance.applied;
  if (from >= steps.length) return 0;
  const tip = (steps[steps.length - 1] as Step).hash;
  const range = from === 0 ? tip : `${(steps[from - 1] as Step).hash}..${tip}`;
  const indexOf = new Map(steps.map((s, i) => [s.hash, i]));
  const child = spawn(
    "git",
    [
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
    ],
    { cwd: topLevel, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });

  let step = -1;
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let renameFrom: string | undefined;
  let hunks: Array<[number, number, number]> = [];
  let deleted = false;
  let replayed = 0;
  /** Body lines of the current hunk still to come: their content must never be read as a header. */
  let body = 0;

  const flushFile = () => {
    if (step < 0) return;
    if (renameFrom !== undefined && newPath !== undefined) provenance.rename(renameFrom, newPath);
    if (deleted && oldPath !== undefined) provenance.remove(oldPath, step);
    else if (newPath !== undefined && hunks.length > 0) provenance.applyHunks(newPath, step, hunks);
    oldPath = undefined;
    newPath = undefined;
    renameFrom = undefined;
    hunks = [];
    deleted = false;
  };
  const flushStep = () => {
    flushFile();
    if (step >= 0) {
      onStep?.(step);
      replayed++;
    }
  };

  for await (const line of lines) {
    if (body > 0 && (line.startsWith("+") || line.startsWith("-"))) {
      body--;
      continue;
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("\u0001")) {
      flushStep();
      const index = indexOf.get(line.slice(1).trim());
      step = index ?? -1;
      if (step >= 0) provenance.beginStep(step);
    } else if (line.startsWith("diff --git ")) {
      flushFile();
      body = 0;
    } else if (line.startsWith("rename from ")) {
      renameFrom = unquote(line.slice(12));
    } else if (line.startsWith("rename to ")) {
      newPath = unquote(line.slice(10));
    } else if (line.startsWith("deleted file mode")) {
      deleted = true;
    } else if (line.startsWith("--- ")) {
      const p = line.slice(4);
      if (p !== "/dev/null") oldPath = unquote(p).replace(/^a\//, "");
    } else if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      if (p !== "/dev/null") newPath = unquote(p).replace(/^b\//, "");
    } else if (line.startsWith("@@")) {
      const m = HUNK.exec(line);
      if (m) {
        const oldCount = m[2] === undefined ? 1 : Number(m[2]);
        const newCount = m[4] === undefined ? 1 : Number(m[4]);
        hunks.push([Number(m[1]), oldCount, newCount]);
        body = oldCount + newCount;
      }
    }
  }
  flushStep();
  const code: number = await new Promise((done) => child.on("close", done));
  if (code !== 0) throw new Error(`git log failed: ${stderr.trim().split("\n")[0]}`);
  return replayed;
}
