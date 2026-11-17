import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isSensitivePath } from "../src/analysis/sensitivity.js";
import { analyze } from "../src/analyze.js";
import { commitAt, initRepo, makeTree } from "./helpers.js";
import { body, values } from "./history-helpers.js";

it("sensitive paths > match the default words as whole path parts", () => {
  for (const path of [
    "src/auth/login.ts",
    "lib/payment-service.ts",
    "session.ts",
    "api/oauth_callback.ts",
    "src/jwt.ts",
  ])
    expect(isSensitivePath(path), path).toBe(true);
});

it("sensitive paths > leave look-alikes alone", () => {
  for (const path of [
    "src/author.ts",
    "src/tokenizer.ts",
    "src/secretary.ts",
    "src/sessionless/none.ts",
    "src/util.ts",
  ])
    expect(isSensitivePath(path), path).toBe(false);
});

it("sensitive paths > take the patterns of the configuration, and ignore case", () => {
  expect(isSensitivePath("src/Vault/keys.ts")).toBe(false);
  expect(isSensitivePath("src/Vault/keys.ts", [/vault/i])).toBe(true);
});

it("sensitive paths > are marked on analyzed files; test files are not rated; configured patterns apply", async () => {
  const dir = makeTree({
    "src/auth/session.ts": body(3),
    "src/util.ts": body(3),
    "src/vault/keys.ts": body(3),
    "src/auth/session.test.ts": body(3),
    "factory-city.config.json": '{ "sensitivePatterns": ["vault"] }',
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("src/auth/session.ts")?.sensitive_path).toBe(1);
  expect(v.get("src/util.ts")?.sensitive_path).toBe(0);
  expect(v.get("src/vault/keys.ts")?.sensitive_path).toBe(1);
  expect(v.get("src/auth/session.test.ts")).not.toHaveProperty("sensitive_path");
});

it("security fixes > are counted from the subjects, with the words by default and the configured patterns", async () => {
  const dir = initRepo({
    "a.ts": body(1),
    "factory-city.config.json": '{ "securityFixPatterns": ["hardening"] }',
  });
  commitAt(dir, "2026-01-01T10:00:00Z", "feat: start");
  const touch = (n: number) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.ts"), body(n));
  };
  touch(2);
  commitAt(dir, "2026-01-02T10:00:00Z", "fix: XSS in the comment box");
  touch(3);
  commitAt(dir, "2026-01-03T10:00:00Z", "chore: hardening of the headers");
  touch(4);
  commitAt(dir, "2026-01-04T10:00:00Z", "feat: nicer buttons");
  touch(5);
  commitAt(dir, "2026-03-20T10:00:00Z", "Patch CVE-2026-1234 in the parser");
  const a = values(await analyze({ folder: dir })).get("a.ts");
  expect(a).toMatchObject({ security_fix_commits: 3, security_fix_commits_recent: 1 });
});

it("security fixes > a feature, a doc or a test that talks about security is not a fix; the project's patterns always count", async () => {
  const dir = initRepo({
    "a.ts": body(1),
    "factory-city.config.json": '{ "securityFixPatterns": ["^chore: hardening"] }',
  });
  commitAt(dir, "2026-01-01T10:00:00Z", "feat: security signals");
  const touch = (n: number) => writeFileSync(join(dir, "a.ts"), body(n));
  touch(2);
  commitAt(dir, "2026-01-02T10:00:00Z", "docs: security ADR");
  touch(3);
  commitAt(dir, "2026-01-03T10:00:00Z", "feat: dependency injection container");
  touch(4);
  commitAt(dir, "2026-01-04T10:00:00Z", "chore: hardening of the headers");
  touch(5);
  commitAt(dir, "2026-01-05T10:00:00Z", "fix(auth): close an XSS hole");
  const a = values(await analyze({ folder: dir })).get("a.ts");
  expect(a?.security_fix_commits).toBe(2);
});

it("security fixes > are unavailable without a git history, never zero", async () => {
  const dir = makeTree({ "a.ts": body(2) });
  const a = values(await analyze({ folder: dir })).get("a.ts");
  expect(a).not.toHaveProperty("security_fix_commits");
  expect(a).not.toHaveProperty("security_fix_commits_recent");
});

it("security configuration > a pattern that is not a regular expression does not stop the analysis", async () => {
  const dir = makeTree({
    "a.ts": body(1),
    "factory-city.config.json": '{ "sensitivePatterns": ["("] }',
  });
  const result = await analyze({ folder: dir });
  // the analysis still runs on the default words; the history step reports the configuration
  expect(values(result).get("a.ts")?.sensitive_path).toBe(0);
});
