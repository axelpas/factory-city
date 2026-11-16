import type { Step } from "../steps.js";
import { DAY, type FileEvent, type FileProvenance, type FileState, type StepTally } from "./types.js";

/** The author who wrote most of the lines now in a file, and the share of lines that is theirs. */
function mainAuthor(origins: readonly number[], labelOf: readonly number[]): { main: number; share: number } {
  const counts = new Map<number, number>();
  for (const origin of origins) {
    const label = labelOf[origin] as number;
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
  return { main, share: origins.length === 0 ? 0 : best / origins.length };
}

/** Rework, lines added and issues in the recent window, read from the newest event backwards. */
function recentActivity(file: FileState, steps: readonly Step[], windowStart: number) {
  let rework = 0;
  let added = 0;
  const issues = new Set<number>();
  for (let i = file.events.length - 1; i >= 0; i--) {
    const e = file.events[i] as FileEvent;
    const step = steps[e.step] as Step;
    if (step.time < windowStart) break;
    rework += e.young;
    added += e.added;
    if (step.link.issue !== undefined) issues.add(step.link.issue);
  }
  return { rework, added, issues: issues.size };
}

export interface MetricsInput {
  files: ReadonlyMap<string, FileState>;
  steps: readonly Step[];
  labelOf: readonly number[];
  /** Number of steps applied so far. */
  applied: number;
  recentDays: number;
  prefix: string;
}

/** Metrics of every file as of the last applied step: history up to that step only. */
export function fileMetricsOf(input: MetricsInput): Map<string, FileProvenance> {
  const out = new Map<string, FileProvenance>();
  const last = input.applied - 1;
  if (last < 0) return out;
  const windowStart = (input.steps[last] as Step).time - input.recentDays * DAY;
  const { prefix } = input;
  const cut = prefix ? prefix.length + 1 : 0;
  for (const [path, file] of input.files) {
    if (prefix && !path.startsWith(`${prefix}/`)) continue;
    if (file.origins.length === 0 && file.events.length === 0) continue;
    const { rework, added, issues } = recentActivity(file, input.steps, windowStart);
    const author = mainAuthor(file.origins, input.labelOf);
    out.set(path.slice(cut), {
      rework_lines: rework,
      rework_ratio: rework === 0 ? 0 : rework / Math.max(rework, added),
      issues_recent: issues,
      main_agent: author.main,
      main_agent_share: author.share,
    });
  }
  return out;
}

export interface Retrospective {
  rework_after?: number;
  caused_fixes: number;
  lines_added: number;
  alive_30?: number;
  alive_90?: number;
}

/**
 * Retrospective metrics of a group of steps (one frame): what later happened to the lines they added.
 * `rework_after` is pending (undefined) until the rework horizon has passed since the frame.
 */
export function retrospectiveOf(
  tallies: readonly (StepTally | undefined)[],
  stepIndices: readonly number[],
  age: { tipTime: number; frameTime: number; reworkDays: number },
): Retrospective {
  let added = 0;
  let reworked = 0;
  let dead30 = 0;
  let dead90 = 0;
  const fixes = new Set<number>();
  for (const i of stepIndices) {
    const t = tallies[i];
    if (!t) continue;
    added += t.added;
    reworked += t.reworked;
    dead30 += t.dead30;
    dead90 += t.dead90;
    for (const f of t.fixes) if (!stepIndices.includes(f)) fixes.add(f);
  }
  const later = age.tipTime - age.frameTime;
  return {
    ...(later >= age.reworkDays * DAY && added > 0 ? { rework_after: reworked / added } : {}),
    // shelf life: known only once 30 and 90 days of later history exist
    ...(added > 0 && later >= 30 * DAY ? { alive_30: 1 - dead30 / added } : {}),
    ...(added > 0 && later >= 90 * DAY ? { alive_90: 1 - dead90 / added } : {}),
    caused_fixes: fixes.size,
    lines_added: added,
  };
}
