# Security indicators: signals in the score, history beside it

- Status: accepted
- Date: 2026-11-17

## Context
A security angle was asked for as an indicator, to challenge (#57, #58, #61). Pattern-based signals are shallow and give false positives, so the design says what they are and keeps them honest.

## Decision
- **Security signals** (`security_signals`, per kind `security_dynamic_code`, `_command_exec`, `_unsafe_html`, `_hardcoded_secret`, `_tls_disabled`, `_sql_concat`, and a density per 1,000 lines) come from declarative rules in the language file, for TypeScript and JavaScript. Test files are not rated; other languages are unavailable (#60). Only counts are kept: never the text of a match, so no secret reaches an output.
- The dimension `security` reads `security_signals` with bounds 0, 1, 3 (a single signal is moderate, two or three high, more very high). It enters the score. The score is also given without it (`scoreWithoutSecurity`, in the report, the manifest and both panels), so that its weight can be seen.
- History: `security_fix_commits` and its recent count come from commit subjects (default words: security, CVE, vulnerab, XSS, CSRF, injection, sanitiz, exploit; `securityFixPatterns` adds more). The dimension `security_fixes` (bounds 0, 1, 2) is a history dimension: it is not in the score, like the other history dimensions.
- `sensitive_path` is a guess made from path words (auth, crypto, payment, secret, token, session, password, credential, permission, acl, rbac, login, jwt; `sensitivePatterns` adds more). It only changes the advice of a hotspot.
- Presets: Security signals, and Risky and moving (signals, with a roof on files that change often).
- Bounds are project defaults, not a standard.

## Consequences
- The score of a TypeScript or JavaScript project can drop when signals are found; the two scores show how much.
- A signal is a place to look at, not a flaw: the metric help says so, and says that a dedicated scanner is still needed. Results of such scanners come in as data (SARIF, #61).
- Scanning the history for secrets is not done: it would read old file contents.

## Addendum: scanner findings (#61, 2026-11-17)
- Results of a third-party scanner come in with `--sarif <file>` (the option is separate from `--with`, which takes no value). The dimension `scanner` reads `sarif_findings` with bounds 0, 2, 5, wider than our own signals because a scanner reports far more, and notes count too. It exists only when a file was given.
- `scoreWithoutSecurity` leaves out both the security signals and the scanner findings.
- A file with no result is 0 only where the tool demonstrably reads that kind of file (same extension as a file it mentions); otherwise it is unavailable.

## Addendum: dependency audit (#59, 2026-11-17)
- `--with audit` asks OSV (api.osv.dev) for the known vulnerabilities of the lockfile's package versions, and writes `dependencies.json`. It is the one analysis step that sends something out, so it is opt-in, says what it sends before it sends it, and `--offline` refuses it. It sends package names and versions only.
- It is not in the score: it is per project, and its answer changes with the date, not with the code. The severity is what the advisory says, never computed here.
- A missing lockfile or a failed request is a warning, never a failure of the analysis.
