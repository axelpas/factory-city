# Factory KPIs and the facts file

- Status: accepted
- Date: 2026-11-15

## Context
The factory layer answers questions the code alone cannot: which agent and model worked on an issue, how it ended, what it cost, how the pull request behaved. Part comes from GitHub, part from a file the user provides. Nothing may be estimated, and nothing may be read from agent session logs.

## Decision
- Facts are imported from one file through a mapping in the configuration (columns by name or position, a row filter, value maps, and a rule that tells attempt rows from other rows). Rows of one issue are merged: numbers are summed, the last attempt gives the outcome, agent and model, and `attempts` counts the attempt rows. Unmapped columns become tags that can group KPIs.
- Level 2 comes from three batched `gh` calls (issues, pull requests, CI runs), cached for 10 minutes. A CI attempt is one commit CI ran on; it is green when every completed run of it succeeded; `ci_attempts` counts attempts up to the first green one. `scope_gap` compares files and lines touched with twice the median of earlier issues with the same estimate, and stays unknown under 5 of them. The estimate is read from a size label (S, M, L, XL, with common prefixes, or `estimatePatterns`), else from the facts.
- KPIs are computed over the issues of a per-issue timeline, for the last 30 days (with the 30 days before) and for the whole timeline, overall and by agent, model, kind, estimate and tag. Shares of lines (rework rate, shelf life) are weighted by the lines each issue wrote on the first-parent history.
- Honesty rules: every KPI carries its sample size; under 5 issues it has no value and says how many it has; a KPI whose field is missing has no value and says which; groups are compared only from 10 issues each, and a smaller group shows its size, not its values.
- `cost_share` (experimental) splits an issue's cost over the files it changed by lines added and deleted.

## Consequences
The importer handles a semicolon-separated routing log through configuration alone; it is tested with a synthetic file of that shape, never with real data. KPIs are presented as questions about the process, not targets, and never rank people. Repositories with more than 1,000 issues, pull requests or runs are only partly covered.
