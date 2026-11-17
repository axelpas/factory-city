import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CACHE_VERSION } from "../src/analysis/cache-version.js";
import { ANALYZER_VERSION } from "../src/analysis/constants.js";
import { loadFileCache } from "../src/timeline/io.js";

it("file cache > its version carries the analyzer version and a fingerprint of the language rules", () => {
  expect(CACHE_VERSION).toMatch(new RegExp(`^${ANALYZER_VERSION.replace(/\./g, "\\.")}\\+[0-9a-f]{12}$`));
});

it("file cache > a cache written under the analyzer version alone, or other rules, is not served", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-cache-"));
  const entry = ["blob|python|0|0", { result: { metrics: {}, syntaxErrors: false, imports: [] } }];
  for (const [name, version] of [
    ["old.json", ANALYZER_VERSION],
    ["other-rules.json", `${ANALYZER_VERSION}+000000000000`],
    ["current.json", CACHE_VERSION],
  ] as const)
    writeFileSync(join(dir, name), JSON.stringify({ version, entries: [entry] }));
  expect((await loadFileCache(join(dir, "old.json"))).size).toBe(0);
  expect((await loadFileCache(join(dir, "other-rules.json"))).size).toBe(0);
  expect((await loadFileCache(join(dir, "current.json"))).size).toBe(1);
});
