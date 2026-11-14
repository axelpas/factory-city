import type { Step } from "./steps.js";

/** A rule of `authorLabels` in the configuration: a pattern on "Name <email>" and the label it gives. */
export interface AuthorRule {
  pattern: string;
  label: string;
}

const TRAILER = /^co-authored-by:\s*(.+?)\s*(?:<[^>]*>)?\s*$/gim;

/** Names in `Co-Authored-By` trailers, in order. */
export function trailerNames(body: string): string[] {
  return [...body.matchAll(new RegExp(TRAILER.source, TRAILER.flags))]
    .map((m) => (m[1] as string).trim())
    .filter(Boolean);
}

/**
 * Who wrote a step. In this order: a `Co-Authored-By` trailer, a rule of the configuration matching the
 * author's name or e-mail, else "unknown". Labels are free text: nothing assumes humans versus agents.
 */
export function authorLabel(step: Step, rules: readonly AuthorRule[]): string {
  const commits = [step, ...step.merged];
  for (const c of commits) {
    const name = trailerNames(c.body)[0];
    if (name) return name;
  }
  // a merge commit is written by whoever merged: the commits it brought say who did the work
  const authored = step.merged.length > 0 ? step.merged : [step];
  for (const c of authored) {
    const identity = `${c.authorName} <${c.authorEmail}>`;
    for (const rule of rules) {
      if (new RegExp(rule.pattern, "i").test(identity)) return rule.label;
    }
  }
  return "unknown";
}
