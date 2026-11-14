# Data model (data contracts)

Status: draft, Phase A. Specification: `specs/factory-city-brief.md` section 7. All contracts are versioned and validated by JSON Schema in both programs.

| Contract | File | Content |
|---|---|---|
| Snapshot | one `cc.json` per frame (gzip allowed) | CodeCharta cc.json 2.x: `meta`, `files` (id, name, type, children), `lenses.metrics` |
| Timeline manifest | `timeline.json` | source info, analyzer version, data level, metric registry, category labels, ignore summary, issue coverage report, ordered frames |
| Factory | `factory.json` | KPIs per period and per group, with sample sizes |
| Facts | `facts.json` | normalized import of the user's facts file |
| Report | `report.json` | risk profile, score, hotspots, movement, factory lists |
| Index | `~/.factory-city/index.json` | analyzed projects, for the project switcher |

## Snapshot rules
- Format: see `decisions/2026-11-14-snapshot-format-cc-json.md`.
- Attributes are numeric; a category is an integer code whose labels live in the manifest.
- An unavailable value is left out, never written as 0.
- File ids are stable across frames (hash of the tree path), so a file keeps its parcel.

## Frame (in `timeline.json`)
`id`, `kind` (feature, fix, refactor, chore, docs, test, unknown), `label`, ISO date, commit, commits included, issue and pull request metadata when known, snapshot reference, totals, risk profile, files added/modified/deleted since the previous frame, frame metrics (specification 6.6).

## Facts row
Keyed by issue number or commit hash. Known fields: `issue`, `commit`, `date`, `agent`, `model`, `outcome` (`succeeded`, `failed`, `abandoned`, `blocked`), `estimate`, `review_blockers`, `review_majors`, `rework_rounds`, `minutes`, `cost`, `currency`, `human_interventions`. Unmapped columns are kept as tags.

## Metric registry entry
`id`, label, definition, computation, why it matters, unit, direction, kind (number, ratio, category), scope (file, folder, frame, factory), data level, limits, flags `experimental` and `retrospective`.

## Analysis manifest (single snapshot)
Until timelines exist, `factory-city analyze` writes `snapshot.cc.json` and `analysis.json` next to each other. `analysis.json` holds: `kind`, `schemaVersion`, `analyzerVersion`, `createdAt` (UTC), `project`, `source` (`disk` or `git`, with `rev` and short `commit`), `dataLevel`, `git` availability, the metric ids present, `categories` (labels of `language` and `is_test`), `selected` and `analyzed` counts, `ignored` (files and folders left out by reason, and entries skipped with a warning), `warnings` and the snapshot file name. It holds no absolute path and no source code. `~/.factory-city/index.json` lists `{slug, name, dataDir, updatedAt}` per project.

## Timeline manifest (as implemented, 2026-11-15)
`factory-city timeline` writes `timeline.<mode>.json` (`commit`, `day` or `revs`) and one snapshot per frame in `frames.<mode>/<id>.cc.json`, so that several modes can live side by side and the viewer can switch between them. The manifest holds: `kind`, `schemaVersion`, `analyzerVersion`, `createdAt`, `project`, `source` (`mode`, `branch`, `firstParent`, `sampledFrom` when `--max-frames` sampled), `dataLevel`, `git`, the metric ids, `categories`, `ignored`, `warnings` and `frames`.
Each frame holds: `id`, `index`, `kind`, `label`, `date` (UTC), short `commit`, `subject`, the short hashes of the `commits` it adds, `snapshot`, `totals` (files, real lines, complexity), `added` / `modified` / `deleted` paths since the previous frame, `metrics` (`files_touched`, `lines_added`, `lines_deleted`, `folders_touched`) and `lines` (per file, `[added, deleted]`).
Category codes are fixed (a language's code is its position in the analyzer's language list), so a code means the same in every frame. `cache/files.json` holds the per-content metric cache; it is not served to the viewer.

In issue mode (`timeline.issue.json`) a frame also carries `issue` (`number`, and at data level 2 `title`, `state`, `labels`, `url`; `pullRequest` when known) or `unlinked: true`, and the manifest carries `coverage` (`commits`, `linked`, `byStrategy`, `issues`, `forge`). See `decisions/2026-11-15-issue-resolution.md`.
