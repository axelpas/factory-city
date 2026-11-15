# Module: `packages/analyzer`

The `factory-city` command line. Depends on `schema` only.

- `source/`: where files come from. `DiskSource` walks a folder (honoring `.gitignore`); `GitSource` reads a revision from the object database through `git ls-tree` and one `git cat-file --batch` process. Nothing is checked out and nothing is written into the analyzed folder.
- `select.ts`: code-first defaults (dependency and build folders, non-engineering folders, folders where almost no file is source code, lockfiles and minified files), `--all`, `--include`, `--exclude`, `--path`, and the ignore summary.
- `inspect.ts`: content checks (binary, Git LFS pointer, non-UTF-8, over 1 MB, generated header comment).
- `languages/`: one declarative JSON file per language; the engine has no language-specific code. Tiers and the steps to add a language are below.
- `parse.ts`: `web-tree-sitter`; a grammar is looked up in `grammars/` (the three bundled ones, see `grammars/NOTICE.md`), then in the VS Code WebAssembly grammar package.
- `collectors/duplication.ts`: optional (`--with duplication`). Copied blocks across the analyzed files, found in memory with the jscpd libraries; gives `duplicated_lines`, `duplication_ratio` and, for the report, the file to deduplicate with.
- `metrics/file-metrics.ts`: `loc`, `rloc`, `comment_lines`, `functions`, `mcc`, `max_function_complexity`, `max_nesting_level`.
- `metrics/cohesion.ts`: LCOM4 generalized to a file (union-find over functions and methods). `metrics/file-metrics.ts` also counts the shortcut kinds from the language's rule set and collects module specifiers.
- `resolve.ts`: resolves imports to files of the project (relative paths, `.js` to `.ts`, tsconfig and jsconfig `paths` and `baseUrl` with `extends`, workspace packages); builds the import graph, `imports_out`, `imports_in` and `folder_cohesion`. No type checker: resolution is a heuristic.
- `collectors/history.ts`: level 1. One `git log --numstat -M -z` up to the analyzed revision gives commits, authors, fixes, recent changes, age and change coupling per file. `config.ts` reads the optional `factory-city.config.json` (`windows.recentDays`, `windows.reworkDays`, `fixPatterns`). `doctor.ts` reports the data level and the next action.
- `timeline.ts`: `factory-city timeline --by commit|day` (also `--revs`, `--branch`, `--since`, `--until`, `--range`, `--max-frames`, `--all-commits`). Each frame is analyzed from the object database at its own revision. A file content is parsed once per blob id and analyzer version (`cache/files.json`); the git log is read once and filtered per frame by reachability, so a frame never uses a later commit.
- `collectors/issues.ts` and `collectors/forge.ts`: `--by issue`. Pure functions find issue numbers in messages, merges and branch names and link each step of the first-parent history to an issue; `forge.ts` loads issues and pull requests through `gh` (replayed from recorded output in tests). The manifest stores a coverage report.
- `collectors/steps.ts`, `provenance.ts`, `authors.ts`, `lineage.ts`: line provenance. One streamed replay of the first-parent diffs keeps the step that wrote each line; rework, contention, authorship and the retrospective frame metrics read from it. Cached per timeline, so an extension replays only the new steps.
- `diff.ts`: `factory-city diff [repo] [base] [head]`. The base defaults to the merge-base with the default branch. It builds a two-frame timeline and a summary; `--json` prints the summary, `--image` writes a PNG, otherwise the viewer opens in compare mode. `render.ts` drives a headless browser through the optional `playwright-core`.
- `health/`: `dimensions.ts` (risk dimensions, bounds and their sources), `health.ts` (risk profile, score, hotspots with actions, hidden links, frame health), `markdown.ts` (the report with one issue-ready block per hotspot). Deterministic and rule-based: no language model. `analyze` writes `report.json`; a timeline writes `report.<mode>.json` for its latest frame and keeps each frame's score, profile and hotspot paths in the manifest.
- `collectors/facts.ts`: the generic facts importer (delimited text or JSON), driven by the mapping in the configuration. `collectors/delivery.ts` and `enrich.ts`: estimate, CI attempts, cycle time, scope gap and the facts fields on each frame, and the cost share per file. `factory/kpis.ts` and `factory/markdown.ts`: the KPIs per period and per group, and the Factory section of the report.
- `bundle.ts`, `redact.ts`, `standalone.ts`, `render.ts`: `factory-city render [dataDir] --image | --video | --html`, with `--source`, `--preset`, `--theme`, `--size`, `--fps`, `--seconds-per-frame`, `--orbit`, `--no-overlay`, `--redact`. The standalone file is built without a browser; pictures and videos come from a headless browser running the viewer's own export code. The file size is printed, with a warning above 15 MB.
- `analyze.ts`, `output.ts`: builds the snapshot and the manifest, writes `~/.factory-city/<slug>/` (or `-o`), updates `index.json`.

Commands so far: `analyze`, `timeline`, `diff`, `report`, `render`, `view`, `doctor`, `metrics`, `languages`, and the default command (analyze, then open). Set `FACTORY_CITY_HOME` to move the output root (the tests do).
Decisions: `decisions/2026-11-14-parsing-web-tree-sitter.md`, `decisions/2026-11-14-metric-definitions-and-thresholds.md`.

## Language tiers

| Tier | Languages | What is measured |
|---|---|---|
| 1 | TypeScript, TSX, JavaScript | Size, complexity, nesting, coupling, cohesion, the full set of shortcuts |
| 2 | Python, Go, Java, C#, C, C++ (and `.h` headers, read with the C++ grammar), Rust, PHP, Ruby, Kotlin, Swift | Size, complexity, nesting, and the shortcuts the configuration lists (lint-disable markers everywhere; skipped tests and empty catch blocks in some). Coupling and cohesion are unavailable. |
| 3 | Any other text file, with `--all` | Lines (`loc`) and the git metrics only |

`factory-city languages` prints the list. A metric a tier does not have is absent from the snapshot: unavailable, never zero. A file with syntax errors is still measured, and the manifest counts such files in a warning.

Known limits of Tier 2: a Python docstring is a string, so it counts as code; a `default` clause counts as a branch in the languages whose grammar gives it the same node as a `case`; Ruby blocks add nesting but are not counted as functions; test files are recognized by name only (`*_test.go`, `test_*.py`, `*Test.java`, `*Tests.cs`, `*_spec.rb`, `*Spec.kt` and the `test` folders).

## How to add a language

1. **Grammar.** Check that `@vscode/tree-sitter-wasm` ships `tree-sitter-<name>.wasm`. If it does not, take the prebuilt `.wasm` of the grammar's upstream release (never a package that compiles at install time), put it in `packages/analyzer/grammars/` with its license text, and add its source, version, license and SHA-256 to `grammars/NOTICE.md` and to `scripts/licenses-check.mjs`. The license must be in the policy (`pnpm licenses:check`).
2. **Configuration.** Add `packages/analyzer/src/languages/<id>.json`: `id`, `label`, `tier`, `grammar`, `extensions`, then the node types of the grammar that count as `comment`, `functions`, `branches` (one decision point each), `logical` (the node and the operators that add a branch, such as `&&`), `nesting` (structures that add a level) and `nestingExceptParent` (an else-if must not go one level deeper). `shortcuts` is a list of rules: `comment` (a pattern in a comment), `node` (a node type and a pattern on its text), `call` (a pattern on the callee), `emptyBlock` (a node whose body holds no statement). A configuration may `extends` another one and only state what differs.
3. **Register.** Import the file in `languages/index.ts` and append it to the list. Append only: the position in the list is the category code stored in snapshots.
4. **Fixture and tests.** Add `test/fixtures/languages/sample.<ext>`, the same small program as the others, and its line in the table of `test/languages.test.ts`. The tests check the metrics of the sample, that every node type named in the configuration exists in the grammar, and that no extension is claimed twice.
5. **Optional.** `imports` and `cohesion` blocks turn on coupling and cohesion; today only the TypeScript family has them, and the import resolver (`resolve.ts`) knows JavaScript module resolution only.

To find the node types, parse a sample and print the tree with `web-tree-sitter` (`tree.rootNode.toString()`), or read the grammar's `node-types.json`.

## Duplication

`factory-city analyze --with duplication` (also on the default command). Blocks of at least 5 lines and 50 tokens that appear twice, within one language, are found with `@jscpd/core` and `@jscpd/tokenizer`, on the content of the analyzed revision, in memory: nothing is written and no source text is kept. `duplicated_lines` counts each copied line of a file once; `duplication_ratio` divides by the file's lines. Without the option the two metrics are absent, the Duplication preset is listed as unavailable with the option to use, and the duplication dimension of the report is unrated. Timelines do not compute duplication.
