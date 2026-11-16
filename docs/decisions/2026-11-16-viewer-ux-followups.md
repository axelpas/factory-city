# Viewer UX follow-ups: names, panels, accessibility

- Status: accepted
- Date: 2026-11-16

## Context
The UX audit (#30) left six follow-ups: the status line (#26), the timeline bar (#24), district names and selection (#27), small windows (#29), keyboard and screen-reader use (#28).

## Decision
- **District names are laid over the canvas, placed by a pure function** (`view/district-labels.ts`): each name hangs from the edge of its plinth nearest to the viewer, in the street, and is not shown when its box would meet a building (tested by ray), another name or a panel. Top-level names are always tried; a deeper name needs an edge wide enough for it, so it appears as the camera comes closer. The same placement draws the names on exported pictures.
- **Under 1100 px the panels overlay the stage** instead of taking room from the city: the view panel starts folded, and the free area ignores both panels. Under 820 px they are sheets.
- **No accessibility dependency.** The automated check is a script run in the real-browser tests (accessible names, canvas description, target size, focus movement), and contrast is checked from the theme tokens in unit tests. `axe-core` (MPL-2.0) would be the next step if a fuller audit is wanted.
- Focus moves into the help, a menu and the inspector when they open and returns to the control that had it when they close; `/` opens a file finder, the keyboard path to the files of the city.

## Consequences
A dense district can go unnamed at some angles: the names trade completeness for never covering a building. The risk-high color is no longer used as text (it fails 4.5:1 on the light panels); controls have a 3:1 edge (`--control-edge`).
