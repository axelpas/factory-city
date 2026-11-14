# Snapshot format: CodeCharta cc.json 2.x

- Status: accepted (2026-11-14)
- Date: 2026-11-14

## Context
Every snapshot must open in CodeCharta (BSD-3-Clause; analysis 2.4.0 and visualization 2.11.0 released 2026-11-10). Its format changed: schema 2.0 is a breaking restructure to `{ meta, files, lenses }`. Nodes carry a stable `id` (first 16 hex of sha-256 of the tree path), an optional `contentHash`, and no metrics. Metrics live in `lenses.metrics.attributes[<id>]`, with `attributeTypes` and `attributeDescriptors`. `meta` requires `projectName`, `apiVersion` (`^2\.\d+$`) and `checksum` (MD5). 2.1 adds a richer dependency lens. Readers use `additionalProperties: false`, so unknown fields are rejected. The schema is published at `dev_docs/cc-json-2.0.schema.json` in the CodeCharta repository.

## Decision
Target cc.json 2.0 (valid for any 2.x reader), validated with the published schema. Node ids give each file a stable identity across frames, which suits stable parcels. Analyzer-specific data (frame metrics, category labels, data levels, registry) goes in `timeline.json`, not in the cc.json. Unavailable values are left out of `lenses.metrics.attributes`. Reuse CodeCharta names where they exist: `rloc`, `loc`, `mcc` (our `complexity`), `functions`, `comment_lines`, `number_of_commits` (our `commits`), `number_of_authors` (our `authors`), `highly_coupled_files`, `max_nesting_level`. The remaining names (`fix_commits`, `max_function_complexity`...) are confirmed when each metric is implemented.

## Consequences
Folder-scope metrics fit `lenses.metrics.attributes` (folders have ids), so no manifest fallback is expected. The older 1.x format (`nodes`, `projectName`) is not produced. Our own validators ship a copy of the CodeCharta schema with its license notice.

## Addendum (milestone 1, 2026-11-14)
Verified against the published schema: `files` is an array holding the single root folder named `root`; node ids hash the canonical path `/root/<path>`; `attributeTypes` maps each metric to `absolute` or `relative`. CodeCharta names in use: `loc`, `rloc`, `comment_lines`, `functions`, `mcc` (our complexity), `max_function_complexity`, `max_nesting_level`; `fix_commits`, `number_of_commits` and `number_of_authors` are confirmed to exist for milestone 4. The category metrics `language` and `is_test` are stored as integers, with their labels in `analysis.json`.
