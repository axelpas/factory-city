# Layout: one deterministic treemap for the whole timeline

- Status: proposed
- Date: 2026-11-14

## Context
Nothing may move during a timelapse. Prior art: the history-resistant layout of M3triCity (Pfahler et al., VISSOFT 2020), Mindwalk's deterministic map.

## Decision
`packages/layout` is a pure function. Input: the union of all file paths over all frames, each file weighted by its maximum ground-area value over time. Output: one rectangle per file and per folder, using a hierarchical treemap (`d3-hierarchy` tiling, with a fixed sort by path, no randomness). A building's footprint scales inside its parcel and never exceeds it; twist shrinks all footprints by one common factor. Changing the ground-area metric recomputes the layout once. Parcels of files absent from a frame are drawn as empty lots.

## Consequences
Same input gives the same map, which a test proves. Large files that shrink later keep a large parcel; that is intended.

## Addendum 2026-11-15: streets between districts
Districts could not be told apart: plinths touched. Every folder but the root now keeps a street margin free around its plinth (0.9% of the map side at the top level, 0.7 times that at each level below, never more than 12% of the folder's smaller side). The margin is part of the same pure function (`street` option, 0 turns it off), so the map stays deterministic and parcels still never move. The slab under the city takes the theme's `street` color and each folder level is a step lighter. Parcels are slightly smaller for the same weights.
