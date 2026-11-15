# Module: `packages/analyzer`

The `factory-city` command line. Depends on `schema` only.

- `source/`: where files come from. `DiskSource` walks a folder (honoring `.gitignore`); `GitSource` reads a revision from the object database through `git ls-tree` and one `git cat-file --batch` process. Nothing is checked out and nothing is written into the analyzed folder.
- `select.ts`: code-first defaults (dependency and build folders, non-engineering folders, folders where almost no file is source code, lockfiles and minified files), `--all`, `--include`, `--exclude`, `--path`, and the ignore summary.
- `inspect.ts`: content checks (binary, Git LFS pointer, non-UTF-8, over 1 MB, generated header comment).
- `languages/`: one declarative JSON file per language (`typescript`, `tsx`, `javascript`); the engine has no language-specific code. To add a language, add a JSON file with its grammar and node types, then fixtures.
- `parse.ts`: `web-tree-sitter` with the VS Code WebAssembly grammars.
- `metrics/file-metrics.ts`: `loc`, `rloc`, `comment_lines`, `functions`, `mcc`, `max_function_complexity`, `max_nesting_level`.
- `metrics/cohesion.ts`: LCOM4 generalized to a file (union-find over functions and methods). `metrics/file-metrics.ts` also counts the shortcut kinds from the language's rule set and collects module specifiers.
- `resolve.ts`: resolves imports to files of the project (relative paths, `.js` to `.ts`, tsconfig and jsconfig `paths` and `baseUrl` with `extends`, workspace packages); builds the import graph, `imports_out`, `imports_in` and `folder_cohesion`. No type checker: resolution is a heuristic.
- `collectors/history.ts`: level 1. One `git log --numstat -M -z` up to the analyzed revision gives commits, authors, fixes, recent changes, age and change coupling per file. `config.ts` reads the optional `factory-city.config.json` (`windows.recentDays`, `windows.reworkDays`, `fixPatterns`). `doctor.ts` reports the data level and the next action.
- `timeline.ts`: `factory-city timeline --by commit|day` (also `--revs`, `--branch`, `--since`, `--until`, `--range`, `--max-frames`, `--all-commits`). Each frame is analyzed from the object database at its own revision. A file content is parsed once per blob id and analyzer version (`cache/files.json`); the git log is read once and filtered per frame by reachability, so a frame never uses a later commit.
- `collectors/issues.ts` and `collectors/forge.ts`: `--by issue`. Pure functions find issue numbers in messages, merges and branch names and link each step of the first-parent history to an issue; `forge.ts` loads issues and pull requests through `gh` (replayed from recorded output in tests). The manifest stores a coverage report.
- `collectors/steps.ts`, `provenance.ts`, `authors.ts`, `lineage.ts`: line provenance. One streamed replay of the first-parent diffs keeps the step that wrote each line; rework, contention, authorship and the retrospective frame metrics read from it. Cached per timeline, so an extension replays only the new steps.
- `diff.ts`: `factory-city diff [repo] [base] [head]`. The base defaults to the merge-base with the default branch. It builds a two-frame timeline and a summary; `--json` prints the summary, `--image` writes a PNG, otherwise the viewer opens in compare mode. `render.ts` drives a headless browser through the optional `playwright-core`.
- `analyze.ts`, `output.ts`: builds the snapshot and the manifest, writes `~/.factory-city/<slug>/` (or `-o`), updates `index.json`.

Commands so far: `analyze`, `timeline`, `diff`, `view`, `doctor`, `metrics`, `languages`, and the default command (analyze, then open). Set `FACTORY_CITY_HOME` to move the output root (the tests do).
Decisions: `decisions/2026-11-14-parsing-web-tree-sitter.md`, `decisions/2026-11-14-metric-definitions-and-thresholds.md`.
