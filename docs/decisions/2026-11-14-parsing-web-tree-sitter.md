# Parsing: web-tree-sitter with the VS Code grammar pack

- Status: proposed
- Date: 2026-11-14

## Context
We need a parser without a JVM or native build. Checked on 2026-11-14, loading each grammar in Node:
- `web-tree-sitter` 0.27.2, MIT, published 2026-11-07.
- `@vscode/tree-sitter-wasm` 0.3.1, MIT, 2026-04-07: loads with 0.27.2. Covers TypeScript, TSX, JavaScript, Python, Go, Java, C#, C++, Rust, PHP, Ruby. No C, Kotlin or Swift.
- `tree-sitter-wasms` 0.1.13, Unlicense, last published 2025-10-07: covers all Tier 1 and Tier 2 languages, but fails to load with `web-tree-sitter` 0.27.2 (dylink error) and loads only with 0.25.x.
- `metric-gardener`: rejected, see `2026-11-14-metric-gardener-not-used.md`.

## Decision
Use `web-tree-sitter` 0.27.2 with `@vscode/tree-sitter-wasm` 0.3.1. This fully covers Tier 1 and eight of the eleven Tier 2 languages (all but C, Kotlin and Swift). The source for those three is decided in milestone 13 (candidates: pin `web-tree-sitter` 0.25.x with `tree-sitter-wasms`, or build the missing grammars to WebAssembly ourselves from their MIT sources).

## Consequences
Tier 1 is unaffected. Language configuration stays declarative, one file per language. Grammar binaries are pinned by version and listed in `THIRD-PARTY-NOTICES.md`.
