# Module: `packages/analyzer`

The `factory-city` command line. Depends on `schema` only.

- `source/`: where files come from. `DiskSource` walks a folder (honoring `.gitignore`); `GitSource` reads a revision from the object database through `git ls-tree` and one `git cat-file --batch` process. Nothing is checked out and nothing is written into the analyzed folder.
- `select.ts`: code-first defaults (dependency and build folders, non-engineering folders, folders where almost no file is source code, lockfiles and minified files), `--all`, `--include`, `--exclude`, `--path`, and the ignore summary.
- `inspect.ts`: content checks (binary, Git LFS pointer, non-UTF-8, over 1 MB, generated header comment).
- `languages/`: one declarative JSON file per language; the engine has no language-specific code. Tiers and the steps to add a language are below.
- `parse.ts`: `web-tree-sitter`; a grammar is looked up in `grammars/` (the three bundled ones, see `grammars/NOTICE.md`), then in the VS Code WebAssembly grammar package.
- `collectors/duplication.ts`: optional (`--with duplication`). Copied blocks across the analyzed files, found in memory with the jscpd libraries; gives `duplicated_lines`, `duplication_ratio` and, for the report, the file to deduplicate with.
- `collectors/sarif.ts`: optional (`--sarif <file>`, repeatable). Reads the SARIF 2.1.0 file that a third-party scanner wrote; nothing is run. See "Scanner findings" below.
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
| 1 | TypeScript, TSX, JavaScript, Python, Go, Java, C#, Kotlin, Rust, PHP, Ruby, C, C++ (and `.h` headers, read with the C++ grammar) | Size, complexity, nesting, coupling, cohesion, shortcuts and security signals: every indicator |
| 2 | Swift | Size, complexity, nesting, and the shortcuts the configuration lists. The other indicators are covered one language at a time (#60). |
| 3 | Any other text file, with `--all` | Lines (`loc`) and the git metrics only |

A language is Tier 1 exactly when it has every indicator (a test checks it). Coverage by indicator, as `factory-city languages` prints it:

| Language | Coupling | Cohesion | Shortcuts | Security signals |
|---|---|---|---|---|
| TypeScript, TSX, JavaScript | yes | yes | full set | yes |
| Python | yes | yes | lint, type-checker, skipped tests, empty except | yes |
| Java | yes (explicit imports only) | yes (bare names count) | lint, disabled tests, empty catch | yes |
| C, C++ | yes (`#include` by path) | yes (functions by shared globals and types; C++ methods by class, also outside it) | lint suppressions, disabled tests (C++: empty catch) | yes (incl. unsafe library functions) |
| Ruby | yes (`require_relative` by path, `require` along the load path) | yes (`@` members, `attr_*`) | rubocop and type-checker suppressions, skipped and focused tests, empty rescue | yes |
| PHP | yes (a class by its file among the files of its namespace; `require` by path) | yes (properties and `$this` calls) | phpcs and type-checker suppressions, `@`, skipped tests, empty catch | yes |
| Rust | yes (the module tree is the folder tree) | yes (methods by `impl`, fields of the struct) | allow attributes, unsafe blocks, ignored tests, empty error arm | yes |
| Kotlin | yes (a class by its file, a function by its package) | yes (primary constructor parameters are fields) | lint, ignored tests, empty catch | yes |
| C# | yes (by namespace, from the files that declare it) | yes (bare names count) | lint, nullable opt-out, ignored tests, empty catch | yes |
| Go | yes (a package is a folder) | yes (methods by receiver) | lint, skipped tests, empty error check | yes |
| Swift | unavailable | unavailable | lint-disable markers, some skipped tests and empty catches | unavailable |

`factory-city languages` prints the list. A metric a tier does not have is absent from the snapshot: unavailable, never zero. A file with syntax errors is still measured, and the manifest counts such files in a warning.

Known limits: a Python docstring is a string, so it counts as code; Python module names are matched against the project's files by name (the closest file wins, a project module named like a standard-library one is linked), and a Python class's fields are the members its `__init__` sets; a Go import links to the files of the package's folder (through `go.mod`, else by the end of the path) and counts once in `imports_out`, a Go method belongs to the type of its receiver, and a Go `if err != nil {}` stands for the empty catch; a Java class of the same package needs no import, so it is not linked, and a wildcard import links the files of the package folder; a C# `using` links to every file that declares the namespace and counts once in `imports_out`, and a namespace the analyzed folder does not declare (the framework, packages) has no file; a Kotlin import of a class links its file, an import of a top-level function links the files that declare its package; a Rust `mod x;` links `x.rs` or `x/mod.rs`, a `use crate::a::B` links the module file `a` (the names after it are dropped), another crate of the project is found by the name in its `Cargo.toml`, `std` and dependencies have no file, and `Err(_) => {}` stands for the empty catch; a PHP `use` links the file named after the class among the files that declare its namespace (so a file must declare one), `use function` and `use const` link nothing, and a `require` with a string path is read from the file's folder then from the project root; a Ruby `require_relative` is read from the file's folder, a `require` is matched by the end of the path (the load path is the project's own), gems and the standard library have no file, and a `rescue` with nothing in it stands for the empty catch; a C or C++ quoted `#include` is read from the file's folder then by the end of the path, an angle include only when it names a folder of the project, and a C function shares a name with others only through globals and types (a prototype declares nothing); a `default` clause counts as a branch in the languages whose grammar gives it the same node as a `case`; Ruby blocks add nesting but are not counted as functions; test files are recognized by name only (`*_test.go`, `test_*.py`, `*Test.java`, `*Tests.cs`, `*_spec.rb`, `*Spec.kt` and the `test` folders).

## How to add a language

1. **Grammar.** Check that `@vscode/tree-sitter-wasm` ships `tree-sitter-<name>.wasm`. If it does not, take the prebuilt `.wasm` of the grammar's upstream release (never a package that compiles at install time), put it in `packages/analyzer/grammars/` with its license text, and add its source, version, license and SHA-256 to `grammars/NOTICE.md` and to `scripts/licenses-check.mjs`. The license must be in the policy (`pnpm licenses:check`).
2. **Configuration.** Add `packages/analyzer/src/languages/<id>.json`: `id`, `label`, `tier`, `grammar`, `extensions`, then the node types of the grammar that count as `comment`, `functions`, `branches` (one decision point each), `logical` (the node and the operators that add a branch, such as `&&`), `nesting` (structures that add a level) and `nestingExceptParent` (an else-if must not go one level deeper). `shortcuts` is a list of rules: `comment` (a pattern in a comment), `node` (a node type and a pattern on its text), `call` (a pattern on the callee), `emptyBlock` (a node whose body holds no statement). A configuration may `extends` another one and only state what differs.
3. **Register.** Import the file in `languages/index.ts` and append it to the list. Append only: the position in the list is the category code stored in snapshots.
4. **Fixture and tests.** Add `test/fixtures/languages/sample.<ext>`, the same small program as the others, and its line in the table of `test/languages.test.ts`. The tests check the metrics of the sample, that every node type named in the configuration exists in the grammar, and that no extension is claimed twice.
5. **Indicators.** `imports` (quoted module paths, TypeScript style) or `modules` (named modules, with a `resolver`), `cohesion` and `security` blocks turn on coupling, cohesion and security signals; `resolve/modules.ts` holds the resolver of each module system (Python, Go, Java, C#, Kotlin, Rust, PHP, Ruby, C, C++ so far). A language with all of them is Tier 1.

To find the node types, parse a sample and print the tree with `web-tree-sitter` (`tree.rootNode.toString()`), or read the grammar's `node-types.json`.

## Duplication

`factory-city analyze --with duplication` (also on the default command). Blocks of at least 5 lines and 50 tokens that appear twice, within one language, are found with `@jscpd/core` and `@jscpd/tokenizer`, on the content of the analyzed revision, in memory: nothing is written and no source text is kept. `duplicated_lines` counts each copied line of a file once; `duplication_ratio` divides by the file's lines. Without the option the two metrics are absent, the Duplication preset is listed as unavailable with the option to use, and the duplication dimension of the report is unrated. Timelines do not compute duplication.

> **2026-11-16:** a run on this repository (`factory-city analyze . --with duplication`, then `factory-city report <dataDir>`) rates duplication at 1.2% of the lines, with 11% of the code in files above the 5% bound. The report gains a Duplication row only when the option was given; timelines do not compute it. The largest findings are the page setup repeated in `render.ts` and the `git` helper defined several times; `glob.ts` exists in both the analyzer and the viewer on purpose, because the two programs share nothing but data files.

## Scanner findings

`factory-city analyze --sarif results.sarif` reads the results of a scanner (Semgrep, CodeQL, Bandit, gosec and others write SARIF). Factory City never installs or runs the scanner (see `docs/decisions/2026-11-17-external-tools-as-optional-data.md`).

- **Kept:** the path, the rule id, the level and the line of each result. Never the message, never a snippet.
- **Metrics:** `sarif_findings` (all levels) and `sarif_error_findings`, per analyzed file. A result with no level takes the default level of its rule, else warning.
- **Score:** the dimension `scanner` reads `sarif_findings` (low at 0, moderate up to 2, high up to 5). It exists only when a SARIF file was given. The score is also given without it and without our security signals (`scoreWithoutSecurity`).
- **Covered or not:** a file is 0 when the SARIF file mentions a file with the same extension (a result, or an `artifacts` entry) and none of its results is on this file; any other file is unavailable, because a scanner that does not read a language says nothing about it. Test files are not rated.
- **Paths:** relative to the analyzed folder, absolute, or `file://`. A scanner that ran inside the folder given with `--path` is matched too.
- **Counted apart, never lost:** results with no location, outside the folder, on files that were not analyzed, and on test files are counted in the manifest (`external[].apart`) and in a warning.
- **Limits:** the counts of two tools are not comparable; a tool decides alone what an error is. Not available on `timeline` (a SARIF file describes one revision).

## Dependency audit

`factory-city analyze --with audit` (opt-in). `analysis/dependencies.ts` reads the lockfile at the root of the analyzed folder (`pnpm-lock.yaml`, `package-lock.json`, then `yarn.lock`, the first one found) with the line-based parsers of `collectors/lockfile.ts`, and `collectors/osv.ts` asks api.osv.dev.

- **What is sent:** to `POST /v1/querybatch`, the ecosystem (`npm`), the package name and the version of each entry, 1,000 per request; then, to `GET /v1/vulns/<id>`, the id of each advisory that matched, to read its severity. Nothing else: no path, no project name, no code. The command prints how many names and versions it sends, and to whom, before the first request.
- **Refused offline:** `--offline` with `--with audit` stops with a message, before anything is done.
- **Result:** `dependencies.json` (type `DependencyAudit`): the date, the lockfile, the number of package versions sent, counts by severity (each advisory once per affected package version), and the affected versions with their advisory ids, most serious first. The severity is the word the advisory gives (`database_specific.severity`), or `unknown`; no CVSS score is computed.
- **Not an error:** no lockfile, or a request that fails, is a warning in the manifest and nothing is written. An older `dependencies.json` is removed when a run does not ask for the audit, so that a stale answer is never shown.
- **Shown:** a Dependencies block at the bottom of the Health tab, with the date, only when the file exists and the source is a snapshot (an audit describes one revision, so it is never shown under the frames of a timeline). `--redact` drops it (package names are project data).
- **Limits:** names and versions of the lockfile only (dev dependencies included); an advisory may not apply to how the package is used; a more recent advisory appears at the next run. npm ecosystem only. Not in the score: it is per project, and the answer changes without the code changing.
