/** A CI run, as the forge reports it. */
export interface CiRun {
  branch: string;
  sha: string;
  /** `success`, `failure`, `cancelled`... empty while the run is not completed. */
  conclusion: string;
  createdAt: string;
}

const DEFAULT_ESTIMATE = /^(?:(?:size|est|estimate|effort)\s*[:/=-]?\s*)?(XS|S|M|L|XL)$/i;

/** The size label of an issue (S, M, L, XL), from its labels and the project's own patterns. */
export function estimateOf(labels: readonly string[], patterns: readonly string[] = []): string | undefined {
  const regexes = [...patterns.map((p) => new RegExp(p, "i")), DEFAULT_ESTIMATE];
  for (const label of labels) {
    for (const re of regexes) {
      const m = re.exec(label.trim());
      if (m?.[1]) return m[1].toUpperCase();
    }
  }
  return undefined;
}

/**
 * CI attempts on a branch up to the first green one. An attempt is one commit that CI ran on; it is green when
 * every completed run of it succeeded. Returns undefined when CI never completed a run on the branch.
 */
export function ciAttempts(
  runs: readonly CiRun[],
  branch: string,
): { attempts: number; firstPassGreen: boolean; green: boolean } | undefined {
  const mine = runs
    .filter((r) => r.branch === branch && r.conclusion !== "")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (mine.length === 0) return undefined;
  const order: string[] = [];
  const green = new Map<string, boolean>();
  for (const run of mine) {
    if (!green.has(run.sha)) {
      order.push(run.sha);
      green.set(run.sha, true);
    }
    if (run.conclusion !== "success" && run.conclusion !== "skipped" && run.conclusion !== "neutral")
      green.set(run.sha, false);
  }
  const first = order.findIndex((sha) => green.get(sha));
  const attempts = first < 0 ? order.length : first + 1;
  return { attempts, firstPassGreen: first === 0, green: first >= 0 };
}

/** Hours between two ISO dates, or undefined when one is missing or they are out of order. */
export function hoursBetween(from: string | undefined, to: string | undefined): number | undefined {
  if (!from || !to) return undefined;
  const hours = (Date.parse(to) - Date.parse(from)) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 10) / 10 : undefined;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export interface Scope {
  estimate?: string;
  files: number;
  lines: number;
}

const MIN_EARLIER = 5;

/**
 * Whether an issue went well beyond its estimate: files or lines touched exceed twice the median of the
 * earlier issues with the same estimate. Unknown (undefined) without an estimate or under 5 earlier issues.
 */
export function scopeGap(current: Scope, earlier: readonly Scope[]): boolean | undefined {
  if (!current.estimate) return undefined;
  const same = earlier.filter((e) => e.estimate === current.estimate);
  if (same.length < MIN_EARLIER) return undefined;
  const files = median(same.map((e) => e.files)) as number;
  const lines = median(same.map((e) => e.lines)) as number;
  return current.files > 2 * files || current.lines > 2 * lines;
}
