import { fileMetricsOf, type Retrospective, retrospectiveOf } from "./provenance/metrics.js";
import { decodeRuns, encodeRuns } from "./provenance/serialize.js";
import {
  DAY,
  type FileEvent,
  type FileProvenance,
  type FileState,
  type Hunk,
  type ProvenanceOptions,
  type SerializedState,
  type StepTally,
} from "./provenance/types.js";
import type { Step } from "./steps.js";

export { replay } from "./provenance/replay.js";
export type { FileProvenance, ProvenanceOptions } from "./provenance/types.js";

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
  applyHunks(path: string, step: number, hunks: ReadonlyArray<Hunk>): void {
    const file = this.file(path);
    const event = this.event(file, step);
    // bottom-up, so that earlier line numbers stay valid
    for (let h = hunks.length - 1; h >= 0; h--) {
      const [oldStart, oldCount, newCount] = hunks[h] as Hunk;
      const at = oldCount === 0 ? oldStart : oldStart - 1;
      const fresh = new Array<number>(newCount).fill(step);
      const removed = file.origins.splice(Math.min(Math.max(at, 0), file.origins.length), oldCount, ...fresh);
      event.added += newCount;
      (this.tallies[step] as StepTally).added += newCount;
      this.settle(removed, step, event);
    }
  }

  /** What replacing lines means for the steps that wrote them: rework, short life, and the fixes that did it. */
  private settle(removed: readonly number[], step: number, event: FileEvent): void {
    const now = (this.steps[step] as Step).time;
    const isFix = (this.steps[step] as Step).isFix;
    const horizon = this.options.reworkDays * DAY;
    for (const born of removed) {
      const bornTally = this.tallies[born];
      if (born === step || !bornTally) continue;
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

  beginStep(step: number): void {
    this.tallies[step] = { added: 0, reworked: 0, fixes: [], dead30: 0, dead90: 0 };
    this.applied = step + 1;
  }

  /** Metrics of every file as of the last applied step: history up to that step only. */
  fileMetrics(prefix: string): Map<string, FileProvenance> {
    return fileMetricsOf({
      files: this.files,
      steps: this.steps,
      labelOf: this.labelOf,
      applied: this.applied,
      recentDays: this.options.recentDays,
      prefix,
    });
  }

  /**
   * Retrospective metrics of a group of steps (one frame): what later happened to the lines they added.
   * `rework_after` is pending (undefined) until the rework horizon has passed since the frame.
   */
  retrospective(stepIndices: readonly number[], frameTime: number): Retrospective {
    const last = this.applied - 1;
    const tipTime = last >= 0 ? (this.steps[last] as Step).time : frameTime;
    return retrospectiveOf(this.tallies, stepIndices, {
      tipTime,
      frameTime,
      reworkDays: this.options.reworkDays,
    });
  }

  /** Lines added by all steps, and how many of them were thrown away within the horizon. */
  tally(step: number): StepTally | undefined {
    return this.tallies[step];
  }

  serialize(): SerializedState {
    const files: SerializedState["files"] = [];
    for (const [path, f] of this.files) {
      files.push([path, { runs: encodeRuns(f.origins), events: f.events }]);
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
      this.files.set(path, { origins: decodeRuns(f.runs), events: f.events });
    }
    this.tallies.length = 0;
    this.tallies.push(...state.tallies);
    this.applied = state.hashes.length;
    return true;
  }
}
