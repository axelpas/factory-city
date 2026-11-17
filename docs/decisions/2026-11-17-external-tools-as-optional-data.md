# External analysis tools: optional data, never a requirement

- Status: accepted
- Date: 2026-11-17

## Context
Tier 2 languages (Python, Go, Java and others) lack coupling, cohesion, shortcuts and security signals. Two ways to fill the gap were weighed: have users install each language's own analyzers (radon, gocyclo, PMD, Semgrep, gosec...), or extend our own tree-sitter analysis. CodeCharta's analyzers give the base metrics (size, complexity) only, and need a JVM or a native toolchain (see `2026-11-14-metric-gardener-not-used.md`).

## Decision
- The core stays our own declarative analysis on tree-sitter: one definition of each metric for every language, so that a score over a polyglot repository means one thing. Coupling, cohesion, shortcuts and security signals are added language by language (#60).
- Factory City never installs, requires or runs another analysis tool: it installs with Node alone, stays read-only on the analyzed code, and gives the same numbers on every machine.
- Results of external tools come in as data, by standard formats and by option. First SARIF, for security scanners (#61). They are labeled as third-party, and only paths, rule ids, levels and lines are kept.

## Consequences
- Language coverage costs rules and import resolution in our code, not user setup.
- A user who wants deeper security checks runs a scanner of their choice and hands over its SARIF file.
- Metrics from a third-party tool never replace ours: they sit beside them.
