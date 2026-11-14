# Line provenance: one replay of first-parent diffs

- Status: proposed
- Date: 2026-11-14

## Context
Rework, authorship and retrospective metrics all need, for every line, the commit that wrote it and when it died. One `git blame` per commit is too slow (target: 2,000 commits in under 3 minutes).

## Decision
Replay the first-parent history once, from `git diff-tree` / `git log -p` output read from the system `git`, keeping per file an array of line origins (commit, date, author label). Follow renames. Deleted or rewritten lines emit a death event with the commit and the age of the line. The pass is cached per commit so extending a timeline reads only new commits. Rework uses a 14-day horizon, `_recent` metrics a 30-day window, both configurable.

## Consequences
Metrics for a frame use only deaths up to that frame, except the retrospective ones (`rework_after`, `caused_fixes`), which are labeled. The SZZ-like `caused_fixes` stays experimental.
