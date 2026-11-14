# Module: `packages/schema`

Data contracts shared by the analyzer and the viewer.

- `registry.ts`: the metric registry (`METRICS`, `getMetric`, `metricsForLevel`). Every metric carries its definition, computation, direction, scope, data level and limits. Pickers, help and reports are built from it.
- `ccjson.ts`: the CodeCharta cc.json 2.0 types, `nodeId` (first 16 hex of sha-256 of `/root/<path>`), `bodyChecksum` and `buildCcJson`.
- `validate.ts`: `validateCcJson` checks a document against CodeCharta's published schema (copied unchanged with its notice) and verifies the checksum.

Rules: an unavailable value is never written; adding a metric means adding one registry entry.
Decisions: `decisions/2026-11-14-snapshot-format-cc-json.md`.
