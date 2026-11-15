# Metric definitions and thresholds

- Status: accepted (2026-11-15)
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

## Addendum: risk thresholds, score and hotspots (milestone 9, 2026-11-15)
Each dimension reads one metric and has three upper bounds (low, moderate, high; above is very high). Bounds are inclusive.

| Dimension | Metric | Low | Moderate | High | Source |
|---|---|---|---|---|---|
| File size | `rloc` | 200 | 400 | 750 | project default, not a standard |
| Complexity | `max_function_complexity` | 10 | 20 | 50 | McCabe's bands for one function (McCabe 1976, as used by the SEI) |
| Nesting | `max_nesting_level` | 3 | 4 | 6 | project default (lint rules commonly cap depth at 4) |
| Coupling | `imports_out` | 10 | 20 | 30 | project default |
| Cohesion | `cohesion_groups`, files of 100 real lines or more | 1 | 2 | 4 | LCOM4: one group is cohesive (Hitz and Montazeri); bands above two are a project default |
| Shortcuts | `escape_hatch_density` | 2 | 8 | 20 | project default |
| Duplication | `duplication_ratio` | 0.03 | 0.05 | 0.2 | project default |
| Change | `recent_commits` | 2 | 5 | 10 | project default |
| Fixes | `fix_commits_recent` | 0 | 1 | 3 | project default |
| Rework | `rework_ratio` | 0.1 | 0.25 | 0.5 | project default |

- `thresholds` in `factory-city.config.json` overrides any dimension; the report always lists the bounds in force and their source.
- A dimension is not rated for a file that has no value for it: unavailable is not low. The profile gives shares among the rated code and says how much of the code was rated.
- Score: share of code, by real lines, in files that are low on every static dimension available for them, out of 100. History dimensions never enter it.
- Hotspots: non-test files ranked by the product of two percentile ranks, complexity and recent commits (files that did not change are left out), or complexity and real lines when there is no history. Ties are broken by path.
- Actions follow the dimensions rated high or very high: split along cohesion groups (named by their declarations), extract functions, flatten nesting, deduplicate, reduce imports, remove shortcuts (by kind), add tests (recent fixes), separate concerns (3 recent issues or more), split a large file. Size is S under 150 real lines, M under 500, else L.
- The report names declarations for cohesion groups only; it holds no source code.

## Addendum 2026-11-15: duplication and Tier 2 (milestone 13)
- Duplication is optional (`--with duplication`). A copied block is at least 5 lines and 50 tokens, the detector's defaults, compared within one language. `duplicated_lines` counts every line of a file that belongs to a copied block once, in the original and in the copy alike; `duplication_ratio` is that count over the file's lines (`loc`). A format the detector does not know has no value. The bounds of the dimension (0.03, 0.05, 0.2) stay a project default.
- Tier 2 complexity uses the same rule as Tier 1: one per function plus one per decision point, where the decision points are the node types listed in the language's configuration. Definitions therefore follow each grammar: a `default` clause counts where the grammar does not tell it from a `case`.
- A shortcut kind may be fed by several rules of a configuration; each kind is counted once in `escape_hatches`.
