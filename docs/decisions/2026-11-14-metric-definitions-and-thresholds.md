# Metric definitions and thresholds

- Status: proposed
- Date: 2026-11-14

## Context
Every metric is declared in a registry (id, definition, computation, direction, scope, data level, limits, flags). Cohesion and risk thresholds need decisions that depend on fixtures and published sources.

## Decision
- The registry in `packages/schema` is the single source for pickers, help and the report; definitions follow section 6.5 of the specification.
- Cohesion is structural: LCOM4 over a file's functions, with `lack_of_cohesion = (groups - 1) / (nodes - 1)`. Whether functions that share a name stem are linked (to avoid scoring sibling components as scattered) is decided in milestone 3 with fixtures, and recorded in a dated addendum.
- Risk thresholds are fixed in milestone 9. Each is documented with its published source, or marked "project default, not a standard". Until then no threshold is assumed.
- The score is a heuristic over static dimensions only.

## Consequences
Adding a metric needs no viewer change. Thresholds are configurable and printed in the output.
