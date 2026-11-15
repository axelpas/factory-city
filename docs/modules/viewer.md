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


Twist rotates a building by `lack_of_cohesion` times 45 degrees. All footprints shrink by 1/sqrt(2) when twist is on, and a per-building check keeps even a thin parcel's building inside it. District tint colors plinths from a folder-scope metric.

## Timeline and animation
- `data/timeline.ts`: a snapshot is a timeline of one frame. All frames share one sorted set of file paths (the union); statistics are computed over all frames so scales stay fixed. The layout is computed once, each file weighted by its largest ground-area value over time, so a parcel never moves.
- `anim/transition.ts`: the on-screen values of a building (position, size, twist, color, roof mark, touched, presence), 15 numbers each, and the interpolation between two states. `anim/animator.ts` decides what is on screen: in *position* mode the picture is a pure function of the playhead (playback and dragging are continuous by construction; a step is 70% move, 30% hold); in *tween* mode a timed move starts from the picture currently shown (jump on the bar, new preset, metric, scale or filter), so nothing ever snaps. Buildings start a few moments apart along a fixed diagonal.
- A new file rises from its lot with its final footprint; a deleted one sinks with the footprint it had. Numeric colors interpolate the value and read the ramp; other colors cross-fade in OKLab.
- `scene/CityScene.ts` runs the same arithmetic in the vertex shader. Instance buffers are written once per step and one uniform drives the move. Edges and roof marks are drawn by the fragment shader; shadows use a depth material with the same vertex code and are redrawn only when buildings move. Resolution adapts when images take too long.
- `view/picking.ts`: exact picking by intersecting the pointer's ray with every building as currently drawn (turned boxes included); an empty parcel is found from the plinth point.
- With reduced motion (system setting, or the Motion picker), movement is replaced by a short cross-fade.
- `?synthetic=5000&frames=6&fps` opens a made-up city and shows images per second; `factoryCityBenchmark()` in the console returns milliseconds per image.

Known limits: one theme; plinths are rebuilt at once when the ground-area metric changes (buildings glide, plinths do not); loading a long timeline fetches every snapshot up front.

## Compare
`view/change.ts`: the Change preset colors each building by what the frame did since the previous one, on the theme's diverging ramp (added and removed at the ends, grown and shrunk in between). A removed file is still drawn at the size it had. The panel lists the biggest changes; a click flies to the building. A diff opens on this preset. URL parameters: `project`, `source`, `preset`. `window.factoryCity` (`ready`, `capture`) is the hook used by headless rendering.
