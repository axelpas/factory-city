# Architecture

Status: draft, Phase A. Specification: `specs/factory-city-brief.md` (sections 5 to 9).

## Shape
Two independent programs that share only data files.

```
repository or folder --> analyzer (CLI) --> data files --> viewer (static web app)
                                                |
                                        report / export / render
```

## Packages (pnpm workspaces, strict TypeScript)
| Package | Role | Depends on |
|---|---|---|
| `packages/schema` | Types, JSON Schemas, validators, metric registry | none |
| `packages/analyzer` | CLI: collectors, report, export | `schema` |
| `packages/layout` | Pure deterministic parcel layout (no DOM, no Node API) | none |
| `packages/viewer` | Static web app (Vite, three.js) | `schema`, `layout` |

The analyzer never imports viewer code and the reverse. `layout` is used by the viewer, and by the headless renderer through the viewer.

## Analyzer collectors
Four independent collectors, one per data level; each declares the metrics it produces and a failing one never breaks the others.

| Collector | Level | Source |
|---|---|---|
| `static` | 0 | file contents, parsed with tree-sitter (WebAssembly) |
| `history` | 1 | the system `git` CLI (object database, no checkout) |
| `forge` | 2 | `gh` CLI, optional, cached, `--offline` disables it |
| `facts` | 3 | a facts file provided by the user |

## Flow
1. Select files (code-first defaults, `.gitignore`, ignore summary).
2. Collect metrics per level, cached by content hash and analyzer version.
3. Write one cc.json per frame, `timeline.json`, `factory.json`, `facts.json`, `report.json`.
4. The viewer loads the files, computes the layout once from the union of paths, and animates frames on a GPU interpolation clock.

## Constraints that shape the design
No JVM and no native compilation; local first, read-only on analyzed code; no source code in outputs; unavailable is never zero.

Decisions: see `decisions/`.

## Serving the viewer
`factory-city view` starts a small HTTP server bound to 127.0.0.1. It serves the built viewer (located by path, never imported), `/projects.json` (from `~/.factory-city/index.json`) and `/data/<slug>/<file>` for the files of an analyzed project. Path traversal and unknown projects are refused. The analyzer and the viewer still share nothing but data files.
