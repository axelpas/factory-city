# Module: `packages/analyzer`

The `factory-city` command line. Depends on `schema` only.

- `source/`: where files come from. `DiskSource` walks a folder (honoring `.gitignore`); `GitSource` reads a revision from the object database through `git ls-tree` and one `git cat-file --batch` process. Nothing is checked out and nothing is written into the analyzed folder.
- `select.ts`: code-first defaults (dependency and build folders, non-engineering folders, folders where almost no file is source code, lockfiles and minified files), `--all`, `--include`, `--exclude`, `--path`, and the ignore summary.
- `inspect.ts`: content checks (binary, Git LFS pointer, non-UTF-8, over 1 MB, generated header comment).
- `languages/`: one declarative JSON file per language (`typescript`, `tsx`, `javascript`); the engine has no language-specific code. To add a language, add a JSON file with its grammar and node types, then fixtures.
- `parse.ts`: `web-tree-sitter` with the VS Code WebAssembly grammars.
- `metrics/file-metrics.ts`: `loc`, `rloc`, `comment_lines`, `functions`, `mcc`, `max_function_complexity`, `max_nesting_level`.
- `analyze.ts`, `output.ts`: builds the snapshot and the manifest, writes `~/.factory-city/<slug>/` (or `-o`), updates `index.json`.

Commands so far: `analyze`, `metrics`, `languages`. Set `FACTORY_CITY_HOME` to move the output root (the tests do).
Decisions: `decisions/2026-11-14-parsing-web-tree-sitter.md`, `decisions/2026-11-14-metric-definitions-and-thresholds.md`.
