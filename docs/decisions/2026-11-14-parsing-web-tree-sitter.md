# Parsing: web-tree-sitter with the VS Code grammar pack

- Status: accepted
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

## Addendum 2026-11-15: C, Kotlin and Swift grammars (milestone 13)
Neither candidate above was kept: pinning `web-tree-sitter` 0.25.x would move Tier 1 to an older runtime, and building grammars ourselves needs a toolchain. The npm packages of the three grammars run a native build at install, so they cannot be dependencies. Their upstream releases, however, contain a prebuilt `.wasm` that loads with `web-tree-sitter` 0.27.2 (checked by parsing a sample of each language without error nodes). These three files are bundled, unchanged, in `packages/analyzer/grammars/`:

| File | Source | Version | License | SHA-256 |
|---|---|---|---|---|
| `tree-sitter-c.wasm` | npm package `tree-sitter-c` | 0.24.1 | MIT, Copyright (c) 2014 Max Brunsfeld | `c852c2a85ebf2beb636aa3b0ef7f7e70458684d74f6741b20dcb296885bed9f9` |
| `tree-sitter-kotlin.wasm` | npm package `@tree-sitter-grammars/tree-sitter-kotlin` | 1.1.0 | MIT, Copyright (c) 2024 Amaan Qureshi | `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7` |
| `tree-sitter-swift.wasm` | GitHub release of `alex-pinkus/tree-sitter-swift` | 0.7.3 | MIT, Copyright (c) 2021 alex-pinkus | `0258a7ef17303a8079ffe0748b3583d59656b5c3e8653fca7b6451b3e6689eb2` |

Consequences: the repository carries 7.9 MB of binary files; `pnpm licenses:check` fails when a bundled grammar is unlisted, changed, or without its license text; `parse.ts` looks in this folder before the grammar package. `.h` files are read with the C++ grammar under their own label, because a C++ header read as C would be full of errors.
