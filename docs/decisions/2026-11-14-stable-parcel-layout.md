# Layout: one deterministic treemap for the whole timeline

- Status: proposed
- Date: 2026-11-14

## Context
Nothing may move during a timelapse. Prior art: the history-resistant layout of M3triCity (Pfahler et al., VISSOFT 2020), Mindwalk's deterministic map.

## Decision
`packages/layout` is a pure function. Input: the union of all file paths over all frames, each file weighted by its maximum ground-area value over time. Output: one rectangle per file and per folder, using a hierarchical treemap (`d3-hierarchy` tiling, with a fixed sort by path, no randomness). A building's footprint scales inside its parcel and never exceeds it; twist shrinks all footprints by one common factor. Changing the ground-area metric recomputes the layout once. Parcels of files absent from a frame are drawn as empty lots.

## Consequences
Same input gives the same map, which a test proves. Large files that shrink later keep a large parcel; that is intended.
