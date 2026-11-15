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

Frame metrics also hold the retrospective `rework_after` (absent while `rework_after_pending` is true, or without provenance) and `caused_fixes` (experimental). `categories.main_agent` lists the author labels.

## Diff summary
`factory-city diff --json` prints a `DiffSummary`, validated by `packages/schema/src/schemas/diff-summary.schema.json`: `kind`, `schemaVersion`, `project`, `base` and `head` (`rev`, short `commit`), `files` (added, removed, modified, unchanged), `totals` (base, head, delta of files, real lines and complexity), `shortcuts` (`added`, `byKind`) and `biggest` (path, status, change of real lines and complexity). The diff itself is a two-frame timeline written as `timeline.diff.json` with `frames.diff/`.

## Report
`report.json` (and `report.<mode>.json` for a timeline's latest frame): `kind`, `schemaVersion`, `analyzerVersion`, `createdAt`, `project`, `commit`, `dataLevel`, `health` (`score`, `profile` by dimension with the shares low / moderate / high / veryHigh and `rated`, `scored`), `dimensions` (id, label, metric, kind, bounds, `minRloc`, source), `hotspots` (path, rank, basis, metrics, thresholds exceeded, actions, size), `hiddenLinks` (experimental) and `notice`. In a timeline each frame carries `health` (`score`, `profile`, `hotspots` paths) and the frame metrics `quality_delta`, `hotspots_created`, `hotspots_resolved`, `shortcuts_added`. The diff summary carries `quality` and `hotspots`.

## Facts and factory (as implemented, 2026-11-15)
- `facts.json` (written next to a timeline when a facts file is given): `kind`, `schemaVersion`, `createdAt`, `rows` (read, kept, skipped), `fields` (the known fields the mapping provides) and `facts`. A fact is keyed by `issue` or `commit` and holds `agent`, `model`, `outcome`, `estimate`, `attempts`, `succeeded_attempts`, `review_blockers`, `review_majors`, `rework_rounds`, `minutes`, `cost`, `currency`, `human_interventions` and `tags` (unmapped columns). A field the file does not have is absent. Facts are private: they never go into `examples/`.
- The mapping lives under `facts` in `factory-city.config.json`: `file`, `delimiter`, `header`, `names`, `columns` (field to header name or position), `filter` (column, values), `values` (raw value to known value, per field) and `attempts` (column, `only` or `not`). A file whose header already uses the field names needs no mapping.
- Frame metrics gain, at level 2, `estimate`, `scope_gap`, `ci_attempts`, `first_pass_green`, `cycle_time_hours`; at level 3, `agent`, `model`, `outcome`, `attempts`, `succeeded_attempts`, `review_blockers`, `review_majors`, `rework_rounds`, `agent_minutes`, `cost`, `currency`, `human_interventions`, `tags`; and the retrospective `lines_written`, `alive_30`, `alive_90`. Snapshots gain the experimental file metric `cost_share`.
- `factory.json` (per-issue timelines): `definitions` (label, definition, level, unit per KPI), `periods` (`last30` with `previous`, and `all`; each with `overall` and `groups` by agent, model, kind, estimate and tag), `lists` (issues to look at) and `notice`. A KPI is `{ value?, n, reason? }`: `value` is absent when the KPI is unavailable, `n` is its sample size.
