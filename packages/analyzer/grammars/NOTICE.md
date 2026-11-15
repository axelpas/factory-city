# Bundled grammars

Three grammars that the grammar package (`@vscode/tree-sitter-wasm`) does not cover are shipped here as
prebuilt WebAssembly files, unchanged from their upstream release. Nothing is compiled at install time.
`pnpm licenses:check` verifies the checksums below.

| File | Upstream | Version | Taken from | License | SHA-256 |
|---|---|---|---|---|---|
| `tree-sitter-c.wasm` | https://github.com/tree-sitter/tree-sitter-c | 0.24.1 | npm package `tree-sitter-c` | MIT, Copyright (c) 2014 Max Brunsfeld | `c852c2a85ebf2beb636aa3b0ef7f7e70458684d74f6741b20dcb296885bed9f9` |
| `tree-sitter-kotlin.wasm` | https://github.com/tree-sitter-grammars/tree-sitter-kotlin | 1.1.0 | npm package `@tree-sitter-grammars/tree-sitter-kotlin` | MIT, Copyright (c) 2024 Amaan Qureshi | `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7` |
| `tree-sitter-swift.wasm` | https://github.com/alex-pinkus/tree-sitter-swift | 0.7.3 | GitHub release asset | MIT, Copyright (c) 2021 alex-pinkus | `0258a7ef17303a8079ffe0748b3583d59656b5c3e8653fca7b6451b3e6689eb2` |

The full license texts are next to the files: `LICENSE-tree-sitter-c.txt`, `LICENSE-tree-sitter-kotlin.txt`,
`LICENSE-tree-sitter-swift.txt`.

To update a grammar: replace the file with the upstream release, update the version and the checksum in this
table and in `scripts/licenses-check.mjs`, then run `pnpm test` (the language tests check that every node
type named in a configuration still exists in the grammar).
