# Metric definitions and thresholds

- Status: proposed
- Date: 2026-11-14

## Context
Every metric is declared in a registry (id, definition, computation, direction, scope, data level, limits, flags). Cohesion and risk thresholds need decisions that depend on fixtures and published sources.

## Decision
- The registry in `packages/schema` is the single source for pickers, help and the report; definitions follow section 6.5 of the specification.
- Cohesion is structural: LCOM4 over a file's functions, with `lack_of_cohesion = (groups - 1) / (nodes - 1)`. Whether functions that share a name stem are linked (to avoid scoring sibling components as scattered) is decided in milestone 3 with fixtures, and recorded in a dated addendum.
- Risk thresholds are fixed in milestone 9. Each is documented with its published source, or marked "project default, not a standard". Until then no threshold is assumed.
- The score is a heuristic over static dimensions only.

## Consequences
Adding a metric needs no viewer change. Thresholds are configurable and printed in the output.

## Addendum: cohesion links (milestone 3, 2026-11-14)
Structural cohesion alone scores sibling components (`Card`, `CardHeader`) and themed helpers (`formatDate`, `formatNumber`) as scattered. Decision: besides name references and shared declarations (variables, types, classes, class fields through `this.`), two functions are linked when their names start with the same word of at least 4 characters (camelCase or PascalCase words), or when one name starts with the other. Fixtures cover both cases and their opposite: `Card` with `Table` stay two groups, a class whose methods share no leading word and no field splits into one group per method.
Known limit: two unrelated functions that happen to share a verb of four letters or more (`parseA`, `parseB`) are linked. Constructors are never nodes. Shortcut kinds and the cohesion node types live in the language's declarative file, not in the engine.

## Addendum: history metrics (milestone 4, 2026-11-15)
- Names follow CodeCharta where it has one: `number_of_commits`, `number_of_authors`, `fix_commits`. The others are ours: `recent_commits`, `lines_added_recent`, `lines_deleted_recent`, `age_days`, `days_since_last_change`, `fix_commits_recent`, `fix_ratio`, `co_change_files`.
- "Now" is the date of the analyzed revision, never the wall clock: the 30-day window ends there, so a past snapshot is reproducible and sees no later commit. Merge commits are not counted; renames are followed.
- A commit is a fix when its subject has the conventional type `fix` or `hotfix`, matches a pattern of `fixPatterns` in `factory-city.config.json`, or arrived through a merged branch named `fix/` or `hotfix/`. Bug labels come with forge data.
- `co_change_files`: two files are coupled when they share at least 3 commits and each appears in at least 60% of the other's commits; commits touching more than 50 files are ignored. These thresholds are project defaults, not a standard; CodeCharta's `highly_coupled_files` uses a comparable rule, and we keep our own name because the definitions are not proven identical.
