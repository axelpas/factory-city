# Issue resolution for the per-issue timeline

- Status: accepted
- Date: 2026-11-15

## Context
Repositories mix several conventions to link work to issues and none is fully reliable. The per-issue timeline must work from git data alone, and get richer with the GitHub CLI.

## Decision
- The first-parent history of the branch is walked step by step. A step is one commit, or a merge commit together with the commits it brought.
- Each step is linked by the first strategy that applies: (1) a closing keyword in a commit message; (2) a pull request (`Merge pull request #n from ...`, or a trailing `(#n)` that the forge knows as a pull request), mapped to the issue the forge says it closes, else to its title, body and branch; (3) a plain reference (`#n`, `GH-n`, an issue URL, or a pattern of `issuePatterns` in `factory-city.config.json`); (4) the issue number in the branch name; (5) otherwise the step is unlinked.
- One frame per issue, at the last step linked to it, ordered by that step. Unlinked steps are grouped per calendar day (UTC) into frames labeled "unlinked".
- Forge data comes from two batched `gh` calls (issues, pull requests, 1,000 each), cached for 10 minutes. `--offline` makes no call. On failure the timeline falls back to git data with a warning.
- A frame's kind comes from the issue labels, then the conventional-commit type, then the branch prefix.

## Consequences
Without the forge a trailing `(#n)` cannot be told apart from an issue reference, so it is read as issue `n`: a squash-merged pull request then shows under its own number. The coverage report says how many commits each strategy linked. Repositories with more than 1,000 issues or pull requests are only partly enriched.
