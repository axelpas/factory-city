import type { Model } from "../data/model";

/** The chip at the bottom of the stage: the data level in two words, the file count, a mark for warnings. */
export interface StatusChip {
  label: string;
  files: string;
  warning: boolean;
}

/** What the chip opens on: what the level gives, what the next one needs, what was left out, warnings. */
export interface StatusDetails {
  gives: string;
  next?: string;
  leftOut: Array<{ reason: string; count: string }>;
  hint?: string;
  warnings: string[];
  coverage?: { text: string; detail: string };
}

const LEVEL_NAMES = ["files", "history", "forge", "facts"] as const;

const GIVES = [
  "File sizes, complexity and structure, read from the code itself.",
  "Changes, fixes and authorship, read from the git history.",
  "Issue titles, labels and CI runs, read from the forge.",
  "Agent, model, outcome and cost per issue, read from your facts file.",
] as const;

function levelOf(model: Model): 0 | 1 | 2 | 3 {
  return model.manifest?.dataLevel ?? 0;
}

function nextStep(model: Model): string | undefined {
  const level = levelOf(model);
  if (level === 0)
    return model.manifest?.git.available
      ? "Git history is available in this repository: analyzing it unlocks level 1 (changes, fixes)."
      : "Analyze a git repository to unlock level 1 (history).";
  if (level === 1) return "Sign in to `gh` on a GitHub repository to add issue titles and CI runs (level 2).";
  if (level === 2) return "A facts file (agent, model, outcome, cost per issue) unlocks level 3.";
  return undefined;
}

/** `snake_case` reasons of the analyzer, read as a sentence. */
function readable(reason: string): string {
  const text = reason.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Warnings worth a mark: a shallow clone first, then what the analyzer reported (syntax errors...). */
export function statusWarnings(model: Model): string[] {
  const m = model.manifest;
  if (!m) return [];
  const out: string[] = [];
  if (m.git.shallow) out.push("Shallow clone: the history is cut, so changes and authorship are incomplete.");
  out.push(...m.warnings);
  return out;
}

export function statusChip(model: Model, format: (n: number) => string): StatusChip {
  const level = levelOf(model);
  return {
    label: `Level ${level} · ${LEVEL_NAMES[level]}`,
    files: `${format(model.files.length)} ${model.files.length === 1 ? "file" : "files"}`,
    warning: statusWarnings(model).length > 0,
  };
}

export function statusDetails(
  model: Model,
  format: (n: number) => string,
  coverage?: { linked: number; commits: number; issues: number; detail: string },
): StatusDetails {
  const m = model.manifest;
  const level = levelOf(model);
  const next = nextStep(model);
  const counts = new Map<string, number>();
  for (const group of [m?.ignored.files ?? {}, m?.ignored.folders ?? {}])
    for (const [reason, n] of Object.entries(group)) counts.set(reason, (counts.get(reason) ?? 0) + n);
  const leftOut = [...counts]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => ({ reason: readable(reason), count: format(n) }));
  return {
    gives: `Level ${level} (${LEVEL_NAMES[level]}): ${GIVES[level]}`,
    ...(next ? { next } : {}),
    leftOut,
    ...(leftOut.length > 0 ? { hint: "Analyze with --all to show everything." } : {}),
    warnings: statusWarnings(model),
    ...(coverage
      ? {
          coverage: {
            text: `${format(coverage.linked)} of ${format(coverage.commits)} commits linked to ${format(coverage.issues)} issues`,
            detail: coverage.detail,
          },
        }
      : {}),
  };
}
