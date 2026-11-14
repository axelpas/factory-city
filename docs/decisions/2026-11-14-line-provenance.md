# Line provenance: one replay of first-parent diffs

- Status: accepted (2026-11-15)
- Date: 2026-11-14

## Context
Rework, authorship and retrospective metrics all need, for every line, the commit that wrote it and when it died. One `git blame` per commit is too slow (target: 2,000 commits in under 3 minutes).

## Decision
Replay the first-parent history once, from `git diff-tree` / `git log -p` output read from the system `git`, keeping per file an array of line origins (commit, date, author label). Follow renames. Deleted or rewritten lines emit a death event with the commit and the age of the line. The pass is cached per commit so extending a timeline reads only new commits. Rework uses a 14-day horizon, `_recent` metrics a 30-day window, both configurable.

## Consequences
Metrics for a frame use only deaths up to that frame, except the retrospective ones (`rework_after`, `caused_fixes`), which are labeled. The SZZ-like `caused_fixes` stays experimental.

## Addendum: as implemented (milestone 7, 2026-11-15)
- The replay streams `git log --first-parent --reverse -m -p -U0 -M` and applies each file's hunks bottom-up to an array of line origins (the index of the step that wrote each line). Hunk body lines are counted, so file content that looks like a diff header is never read as one.
- A step is a first-parent commit, or a merge commit with the commits it brought: lines brought by a merge are dated at the merge, and take the author label and the issue of the merged commits.
- Per file and per step the engine keeps only two counters (lines added, young lines thrown away); per step it keeps the lines added, those reworked within the horizon and the later fix steps that touched them. That is enough for `rework_lines`, `rework_ratio`, `issues_recent`, `main_agent`, `main_agent_share`, and for the retrospective `rework_after` and `caused_fixes`.
- Author label: a `Co-Authored-By` trailer, else the first matching rule of `authorLabels` in `factory-city.config.json`, else `unknown`. The code of `main_agent` is the label's rank of first appearance in the history, so it means the same in every frame.
- A timeline replays once for all its frames. The state is saved in `cache/provenance.<mode>.json` (line origins run-length encoded, plus the file metrics of each frame), so extending a timeline replays only the new steps. A frame that is not on the first-parent history (`--all-commits`, some `--revs`) gets no provenance metric.
- `rework_after` stays absent, with `rework_after_pending`, until 14 days of later history exist. It is never written as 0.
