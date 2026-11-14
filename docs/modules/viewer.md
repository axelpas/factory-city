# Module: `packages/viewer`

The static web app (Vite, three.js, no UI framework). It reads `snapshot.cc.json` and `analysis.json`, and shares nothing else with the analyzer.

- `data/`: `buildModel` turns a snapshot into files, folders, statistics and coverage; `load.ts` fetches a project from the local server or reads dropped files.
- `presets/`: Structure, Cohesion, Three Cs, Shortcuts and Languages as declarative JSON presets (question, area, height, color candidates). A preset is offered only when its metrics cover at least half of the code.
- `themes/`: one token file per theme (`architect.json`); `applyTheme` exposes the tokens as CSS variables. No literal color or font anywhere else (a test scans the sources).
- `view/`: pure logic: scales (linear, sqrt, log, 99th-percentile clamp), color ramps, placements (a building never leaves its parcel), hover card and legend builders. Unit-tested.
- `scene/CityScene.ts`: instanced boxes for buildings and plinths, edges, shadows, exact picking by ray casting, offscreen rendering for export.
- `ui/`: pickers with registry-based help, legend, hover card, details panel, first-open help, PNG export with optional overlay.
- `lib/format.ts`: the single place that turns numbers and dates into text (browser locale, fallback `fr-CH`).

The analyzer's `view` command serves the built viewer from `packages/viewer/dist`, located by path (`FACTORY_CITY_VIEWER` overrides it). It is never imported.
Known limits: no animation yet (the timeline milestone adds it); one theme.

Twist rotates a building by `lack_of_cohesion` times 45 degrees. All footprints shrink by 1/sqrt(2) when twist is on, and a per-building check keeps even a thin parcel's building inside it. District tint colors plinths from a folder-scope metric.
