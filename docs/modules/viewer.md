# Module: `packages/viewer`

The static web app (Vite, three.js, no UI framework). It reads `snapshot.cc.json` and `analysis.json`, and shares nothing else with the analyzer.

- `data/`: `buildModel` turns a snapshot into files, folders, statistics and coverage; `load.ts` fetches a project from the local server or reads dropped files.
- `presets/`: Structure, Cohesion, Three Cs, Shortcuts and Languages as declarative JSON presets (question, area, height, color candidates). A preset is offered only when its metrics cover at least half of the code.
- `themes/`: one token file per theme (`architect.json`); `applyTheme` exposes the tokens as CSS variables. No literal color or font anywhere else (a test scans the sources).
- `view/`: pure logic: scales (linear, sqrt, log, 99th-percentile clamp), color ramps, placements (a building never leaves its parcel), hover card and legend builders. Unit-tested.
- `scene/CityScene.ts`: instanced boxes for buildings and plinths, edges, shadows, exact picking by ray casting, offscreen rendering for export.
- `ui/`: pickers with registry-based help, legend, hover card, details panel, first-open help, PNG export with optional overlay.
- `style.css`: starts with the design tokens (spacing, type and radius scales, control height, layout widths, elevation). Colors and the font come from the theme; every spacing, font size and radius in the rules is a token (a guard test scans the sheet). Controls share one height; selects draw their own arrow; buttons have three levels: `primary`, default, `quiet` (and `icon` for square ones).
- `view/framing.ts`: pure framing math. The city is fitted and centered in the part of the stage that the bar, the panels and the timeline leave free (`CityScene.setFreeArea`), for the default view and for the top view (always orthographic). The fit is kept while the camera is not moved by hand; a picture or a film is framed again for its own size, with no panel around.
- `ui/lens.ts`, `ui/icons.ts`: the top bar reads left to right: what is shown (project, source), the preset picker and its question, then panels and icon actions. The picker lists the presets by group, each with its question; an unavailable preset is disabled and says what data it needs. Theme and motion live in the appearance menu.
- `ui/legend-box.ts`: the legend sits on the stage, at the bottom left of the free area (the app publishes the insets as `--free-*` custom properties). One line per channel (glyph, metric, reading) that opens on the metric's definition, the color scale with its bounds, and the color of the files without a value. `view/legend.ts` builds one `LegendModel` for the stage and for exported pictures.
- `ui/popovers.ts`: one rule for every menu and help popover (a `details` element with the `popover` class): one open at a time, closed by Escape before any panel, or by a press outside. Interface behavior is checked in a real browser by `packages/analyzer/test/ui.test.ts` (page scripts run through `probePage`).
- `lib/format.ts`: the single place that turns numbers and dates into text (browser locale, fallback `fr-CH`).

The analyzer's `view` command serves the built viewer from `packages/viewer/dist`, located by path (`FACTORY_CITY_VIEWER` overrides it). It is never imported.


The marker (`view/marker.ts`) puts a ring on the roof of the files above a threshold on a metric: the threshold typed by the user, else the bound where the metric's risk dimension turns high, else the top tenth. It replaced the twist channel (`decisions/2026-11-15-marker-replaces-twist.md`). District tint colors plinths from a folder-scope metric.

## Timeline and animation
- `data/timeline.ts`: a snapshot is a timeline of one frame. All frames share one sorted set of file paths (the union); statistics are computed over all frames so scales stay fixed. The layout is computed once, each file weighted by its largest ground-area value over time, so a parcel never moves.
- `anim/transition.ts`: the on-screen values of a building (position, size, marker, color, roof mark, touched, presence), 15 numbers each, and the interpolation between two states. `anim/animator.ts` decides what is on screen: in *position* mode the picture is a pure function of the playhead (playback and dragging are continuous by construction; a step is 70% move, 30% hold); in *tween* mode a timed move starts from the picture currently shown (jump on the bar, new preset, metric, scale or filter), so nothing ever snaps. Buildings start a few moments apart along a fixed diagonal.
- A new file rises from its lot with its final footprint; a deleted one sinks with the footprint it had. Numeric colors interpolate the value and read the ramp; other colors cross-fade in OKLab.
- `scene/CityScene.ts` runs the same arithmetic in the vertex shader. Instance buffers are written once per step and one uniform drives the move. Edges and roof marks are drawn by the fragment shader; shadows use a depth material with the same vertex code and are redrawn only when buildings move. Resolution adapts when images take too long.
- `view/picking.ts`: exact picking by intersecting the pointer's ray with every building as currently drawn (turned boxes included); an empty parcel is found from the plinth point.
- With reduced motion (system setting, or the Motion picker), movement is replaced by a short cross-fade.
- `?synthetic=5000&frames=6&fps` opens a made-up city and shows images per second; `factoryCityBenchmark()` in the console returns milliseconds per image.

Known limits: plinths are rebuilt at once when the ground-area metric changes (buildings glide, plinths do not); loading a long timeline fetches every snapshot up front.

## Compare
`view/change.ts`: the Change preset colors each building by what the frame did since the previous one, on the theme's diverging ramp (added and removed at the ends, grown and shrunk in between). A removed file is still drawn at the size it had. The panel lists the biggest changes; a click flies to the building. A diff opens on this preset. URL parameters: `project`, `source`, `preset`. `window.factoryCity` (`ready`, `capture`) is the hook used by headless rendering.

## Health panel
`view/health.ts` builds what the panel shows (key H): the score with its notice, the score trend across frames, what the frame did (score change, hotspots created and resolved), the risk profile as bars with exact shares and thresholds, the hotspots with their suggested actions (a click flies to the building) and the experimental hidden links. It reads `report.json`; in a timeline the score and profile follow the playhead, and the suggested actions describe the latest frame.

## Lenses and Factory panel
`view/lenses.ts` puts the frame metrics on the timeline bar: ticks colored by the kind of the step, markers (failed first CI run, scope gap, lower score), a trend strip that follows the playhead with a choice of series (files, real lines, complexity, score, rework afterwards, fix share, CI attempts, cost) and a card for the frame under the pointer. A series with under two values is not offered, and the help says what would show it. `view/factory.ts` builds the Factory panel (key F) from `factory.json`: KPIs with their sample size and the previous period, groups side by side from 10 issues each, and the issues to look at; a click jumps to the frame. The Cost preset is experimental and needs a facts file with a cost.

## Themes and renderers
A theme is one token file in `themes/` (palette, ramps, lighting, camera, typography, renderer, effects), checked by `validateTheme`. Four ship: Architect's Model (`solid`, perspective, soft shadows), Isometric Plan (`solid`, orthographic camera, flat fills, no shadows), Blocks (`voxel`) and Hologram (`wireframe`, dark). They are switched at runtime (picker, key T, `?theme=`), with the same data mapping and the same legend content.
- The three renderers share one instanced box, the same instance data, animation and picking; the fragment shader draws the difference (a uniform selects the mode). `voxel` draws the seams between cubes and a small shade per cube, both procedural: no texture file. `wireframe` draws luminous edges and faint faces with additive blending, so the picture does not depend on drawing order; its glow is capped at 0.6 by the scene and can be switched off.
- Blocks: `view/voxel.ts` rounds heights to whole blocks (at least one), snaps footprints to whole cells without leaving the parcel, removes twist and shows the color metric in the theme's number of steps. The legend says what one block is worth. Exact values stay in the card and the details panel. The theme prefers a linear scale; leaving it restores the scale chosen before.
- The legend words the color scale for the background: darker on light themes, brighter on the dark one.
- `lib/contrast.ts` holds the checks the tests run on every theme: WCAG contrast of text on its panel, a sequential ramp whose luminance is monotonic, diverging ends that stay apart for red-green color vision deficiencies, risk colors that read in gray.
- Adding a theme with an existing renderer is adding a token file and listing it in `themes/index.ts`: no scene code.

## Export
- Image: PNG of the current view at 1x, 2x or 4K, with or without the overlay (title, frame label, legend).
- Video (`export/video.ts`): `planVideo` puts the film on a virtual clock (images per second, seconds per frame, a hold at the end, an optional slow orbit); `encodeVideo` draws each image and encodes it. The film carries the same interpolated animation as the live view, and reduced motion never applies to it. The Export menu offers it at 30 or 60 images per second.
- Standalone file (`data/embedded.ts`): when the page holds embedded data it is read from the page and nothing is fetched.
- `window.factoryCity` is the hook for headless rendering: `ready`, `capture(width, height, overlay)`, `video(options)`, `imageHashes(positions, width, height)`.
