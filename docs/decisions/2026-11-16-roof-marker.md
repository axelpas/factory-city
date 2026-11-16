# The marker is a pyramid roof

- Status: accepted
- Date: 2026-11-16

## Context
The marker was a ring drawn by the shader on the roof of the files above a threshold. It read as a texture, not as an object, and was easy to lose on a colored roof.

## Decision
Marked files carry a **pyramid roof** in the theme's `marker` color, as wide as the building and at most 0.4 of its narrowest side or 0.6 of its height. It is a second instanced mesh that shares the buildings' instance buffers, so it follows their position, size and animation; the marker value is its height, so it grows and shrinks between frames, and it fades with the other buildings when one is pointed at. In wireframe themes it is drawn as luminous edges.

## Consequences
The marker reads by its shape in every theme and from any angle. Picking still targets the building's box: the apex of a roof is not clickable. Blocks draws the same smooth pyramid, not a stepped one. The ring code is gone from the building shader.
