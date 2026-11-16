import type { FrameKind } from "@factory-city/schema";

const KINDS: Record<string, FrameKind> = {
  feat: "feature",
  feature: "feature",
  fix: "fix",
  hotfix: "fix",
  refactor: "refactor",
  perf: "refactor",
  chore: "chore",
  build: "chore",
  ci: "chore",
  style: "chore",
  revert: "chore",
  docs: "docs",
  doc: "docs",
  test: "test",
  tests: "test",
};

/** Kind of a step, read from the conventional-commit type of its subject. */
export function kindOfSubject(subject: string): FrameKind {
  const m = /^([a-z]+)(\([^)]*\))?!?:/i.exec(subject.trim());
  return (m && KINDS[(m[1] as string).toLowerCase()]) || "unknown";
}
