# AGENTS.md

Instructions for every coding agent and contributor working on this repository. `CLAUDE.md` imports this file.

## Project

- Name: Factory City
- Goal: turn a codebase into a 3D city (folders are districts, files are buildings) to show what a software factory builds, how its quality evolves and what its process leaves behind. An analyzer (CLI) writes data files; a viewer (static web app) reads them.
- Stack: strict TypeScript, pnpm workspaces monorepo, Node.js >= 22, Vitest, Vite, three.js, web-tree-sitter (WebAssembly). Dependency choices are recorded as ADRs in `docs/decisions/`.
- Commands: `pnpm install` / `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` / `pnpm licenses:check` / `pnpm docs:assets` (scripts appear as the milestones land).
- Backlog: GitHub Issues of this repository. One issue per milestone; each issue lists acceptance criteria and a manual scenario.
- Language: English
- Mode: exploration (prototype, no users yet)

## Layout

- `packages/schema`: types, JSON Schemas and validators of the data contracts.
- `packages/analyzer`: the CLI; depends on `schema` only.
- `packages/layout`: the parcel layout, a pure deterministic function (no DOM, no Node API).
- `packages/viewer`: the static web app; depends on `schema` and `layout`.
- `examples/`: demo datasets built from public repositories.
- `docs/`: `architecture.md`, `data-model.md`, `glossary.md`, `decisions/` (ADRs), `modules/<package>.md`.

## Where the knowledge is

- Architecture and boundaries: `docs/architecture.md`
- Data contracts: `docs/data-model.md`
- Vocabulary: `docs/glossary.md`
- Decisions: `docs/decisions/` (`YYYY-MM-DD-title.md`, about 10 lines: context, decision, consequences)

## Invariants

- The analyzer and the viewer share nothing but the data files; neither imports the other.
- Read-only on analyzed code: never check out, modify or write into an analyzed folder.
- No source code in outputs: paths, metrics, git and issue metadata, and declaration names only where the report needs them.
- An unavailable value is stored and shown as unavailable, never as zero.
- Git-derived metrics of a frame use history up to that frame only (retrospective metrics are labeled and never change the frame's city).
- Parcels never move during a timeline: same input, same map.
- Dependencies: MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, Unlicense, CC0, or MPL-2.0 unmodified. No Java, no native compilation at install time.
- No network in tests; `gh` output is replayed from recordings.
- Each invariant gets a test; until it has one, say so in the issue.

## Conventions

- Everything in English: code, identifiers, commits, issues, docs.
- Tests are written with the code, from the acceptance criteria. Typecheck, lint and tests are green before an issue is closed.
- No `any`, no `@ts-ignore`, no stray `console.log`, no hard-coded secret. Fixtures that contain shortcuts on purpose are excluded from lint and from guard tests.
- Dates and numbers shown to users go through the single `lib/format` module (browser locale, fallback `fr-CH`). Store dates in UTC.
- Commits: `type(scope): description (#n)`. Branch per issue, pull request referencing the issue; during the initial build, commits go to `main`.
- Structural decisions (dependency, data contract, layout algorithm, metric definitions and thresholds) get an ADR in the same commit.
- A reference doc is not rewritten when facts change: the outdated section gets a dated box saying what changed and where the truth now lives.
- No changelog file: history is read from merged pull requests, closed issues and commits.

## Known pitfalls

- Avoid dependencies that need Python or a C/C++ toolchain at install time (for example `metric-gardener`); prefer pure JavaScript or WebAssembly.
- The cc.json snapshot format must stay valid for CodeCharta's schema: numeric attributes only, categories stored as integer codes with labels in the manifest.
