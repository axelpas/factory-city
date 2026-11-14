# Module: `packages/layout`

The parcel layout: `computeLayout(files, options)` returns one rectangle per file and per folder.

- Pure and deterministic: no DOM, no Node API (its tsconfig loads no ambient types), no randomness. The same set of files gives the same map whatever the input order.
- Built on the `d3-hierarchy` squarified treemap. Siblings are ordered by weight, then by path. Each file weighs at least 1, so a file with no value still gets a parcel.
- Folders are plinths (nested rectangles); a small padding separates parcels and frames each folder.

Decision: `decisions/2026-11-14-stable-parcel-layout.md`. The timeline will feed it the union of all paths, each weighted by its maximum over time.
