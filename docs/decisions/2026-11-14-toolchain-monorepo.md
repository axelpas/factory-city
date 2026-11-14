# Monorepo toolchain

- Status: accepted (2026-11-14)
- Date: 2026-11-14

## Context
Strict TypeScript, pnpm workspaces. Local machine: Node 24.13.1, pnpm 12.18.0. Versions on npm on 2026-11-14: `vite` 8.3.8 (MIT), `vitest` 5.1.0 (MIT), `typescript` 7.0.2 (Apache-2.0), `commander` 15.1.0 (MIT), `ajv` 8.20.0 (MIT).

## Decision
pnpm workspaces; Vitest for tests; Vite for the viewer; `commander` for the CLI; `ajv` to validate JSON Schemas. Node >= 22 as the declared minimum, tested on the LTS lines. The TypeScript major and the linter (ESLint with typescript-eslint, or Biome) are fixed in milestone 1 after checking that the linter supports the chosen TypeScript version; the choice is appended to this ADR.

## Consequences
No native compilation anywhere in the install. All of these pass the license policy.

## Addendum (milestone 1, 2026-11-14)
`typescript-eslint` 8.72.2 supports TypeScript `>=4.8.4 <6.1.0`, so it cannot lint with TypeScript 7.0.2. Decision: lint and format with Biome 2.6.7 (MIT OR Apache-2.0; `noExplicitAny`, `noTsIgnore` and `noConsole` set to error) and typecheck with TypeScript 7.0.2 (`tsc -b`). Tests are Vitest 5.1.0. The CLI uses `commander` 15.1.0 and `ajv` 8.20.0 validates the schemas.
