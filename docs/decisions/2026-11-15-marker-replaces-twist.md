# A threshold marker replaces the twist channel

- Status: accepted
- Date: 2026-11-15

## Context
The brief gave buildings an optional twist: a rotation by a metric, after VERSO. In use, an angle is a weak way to show a quantity: it reads poorly, it disturbs the reading of the area, and it forced every footprint to shrink by 1/sqrt(2) so that a turned building stayed inside its parcel. Found by the viewer audit of 2026-11-15 and decided with the project owner.

## Decision
The twist channel is removed. A **marker** channel replaces it: the files whose value is above a threshold on a chosen metric carry a ring on their roof. The threshold is, in order: the value typed by the user; the bound above which the metric's risk dimension rates a file "high" (read from the report); else the value that leaves the top tenth of the files above it. A file without a value is never marked. The ring is drawn in the theme's `marker` color and outlined in the edge color, so that it is told by its shape and not by its hue alone. The Three Cs preset marks `cohesion_groups` instead of turning buildings by `lack_of_cohesion`.

## Consequences
Buildings use their whole parcel again (but the inset) in every preset. A fourth metric is shown as a yes or no, not as a quantity: the exact value stays in the card and the details. The state of a building keeps 15 numbers; the slot of the twist holds the mark, which fades in and out between frames. This is a deviation from section 7 of the brief.
