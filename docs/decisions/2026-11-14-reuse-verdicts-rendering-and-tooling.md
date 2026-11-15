# Reuse verdicts: duplication, 3D, layout, video, headless

- Status: accepted (2026-11-15)
- Date: 2026-11-14

Versions and licenses checked with `npm view` on 2026-11-14.

| Candidate | Version | License | Last published | Verdict | Reason |
|---|---|---|---|---|---|
| `jscpd` | 5.4.3 | MIT | 2026-11-08 | use, optional (`--with duplication`) | Maintained, pure JavaScript; run through its API, not bundled by default |
| `three` | 0.187.0 | MIT | 2026-10-30 | use | Instanced rendering, custom shaders for animation and the three building renderers |
| `d3-hierarchy` | 3.1.3 | ISC | 2026-11-03 | use | Treemap tiling as the base of the layout (see the layout ADR) |
| `mediabunny` | 1.66.0 | MPL-2.0 | 2026-11-13 | use, unmodified | WebCodecs muxing to MP4/WebM; MediaRecorder as fallback |
| `playwright` | 1.65.1 | Apache-2.0 | 2026-11-14 | optional or dev only | Headless `render`; the core install must not download a browser |

## Consequences
MPL-2.0 is allowed only unmodified. Playwright is a peer or dev dependency; `render` explains how to install a browser when missing.

## Addendum: headless rendering (milestone 8, 2026-11-15)
Headless pictures use `playwright-core` 1.65.1 (Apache-2.0), an optional dependency of the analyzer: the same project as `playwright` without the browser download, so the core install downloads no browser. It drives the system's Google Chrome first, then a Chromium installed for Playwright; without either, the command says how to install one. The page exposes `window.factoryCity.ready` and `window.factoryCity.capture(width, height, overlay)`, so the picture comes from the viewer's own export code.

## Addendum: video and standalone HTML (milestone 12, 2026-11-15)
- Video: the film is rendered offline, image by image, on a virtual clock: image `i` shows the timeline at `i / fps` seconds. The picture is a pure function of the playhead position, so two renders of the same data give the same images (checked in a real browser by fingerprinting images). Encoding uses WebCodecs through `mediabunny` 1.66.0 (MPL-2.0, unmodified, loaded on demand): MP4 with H.264 when the browser can encode it, otherwise WebM (VP9, then VP8); without WebCodecs, the browser's `MediaRecorder` records the canvas, which is not deterministic in timing.
- Headless: `factory-city render` drives the same export code through the page hook (`window.factoryCity.capture`, `video`, `imageHashes`). With `--redact` it renders from a redacted copy of the data written to a temporary folder and removed afterwards.
- Standalone HTML: built by the analyzer with no browser. The viewer's script and style are inlined, and the data (manifest, snapshots, report, factory) is embedded as gzip then base64 in a `<script id="factory-city-data" type="application/octet-stream">` element, read with `DecompressionStream`. The file makes no request and opens from `file://`.
- `--redact` removes commit subjects, issue titles and URLs, author and agent labels (`main_agent`), every facts field of the frames, `cost_share`, the factory KPIs, and the declaration names of the report. Paths, code metrics, dates, issue numbers and the score stay.
