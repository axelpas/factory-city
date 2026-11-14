# Reuse verdicts: duplication, 3D, layout, video, headless

- Status: proposed
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
