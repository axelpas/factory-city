# metric-gardener is a reference only

- Status: accepted
- Date: 2026-11-14

## Context
`metric-gardener` (MaibornWolff, BSD-3-Clause) lists per-language node types for metrics. Its README requires Python, node-gyp and a C/C++ toolchain (Xcode Command Line Tools on macOS) at install time, and marks its dependency analysis "EXPERIMENTAL - VERY SLOW". It publishes no releases on GitHub.

## Decision
Do not depend on it. It may be read as a reference for node-type configuration; any borrowed configuration keeps its BSD-3-Clause notice.

## Consequences
Our own declarative language files are written and tested from fixtures.
