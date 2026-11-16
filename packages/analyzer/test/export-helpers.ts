import { existsSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import { defaultViewerDir } from "../src/server.js";

import { buildTimeline } from "../src/timeline.js";

import { commitAt, initRepo, makeTree } from "./helpers.js";

export const TRAILER = "\n\nCo-Authored-By: Agent One <one@example.com>";

export const code = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `export function f${i}(x: number) { return x + ${i}; }`).join("\n")}\n`;

/** A per-issue timeline of three frames, with a facts file: everything `--redact` has something to remove from. */

export async function sample() {
  const dir = initRepo({
    "src/a.ts": code(3),
    "factory-city.config.json":
      '{ "facts": { "columns": { "issue": "issue", "agent": "agent", "cost": "cost" } } }',
  });
  commitAt(dir, "2026-01-01T10:00:00Z", `feat: secret launch plan (#1)${TRAILER}`);
  writeFileSync(join(dir, "src/b.ts"), code(6));
  commitAt(dir, "2026-01-02T10:00:00Z", `feat: add the billing module (#2)${TRAILER}`);
  writeFileSync(join(dir, "src/a.ts"), code(9));
  commitAt(dir, "2026-01-03T10:00:00Z", "fix: repair the invoice total (#3)");
  const facts = join(
    makeTree({ "facts.csv": "issue,agent,cost\n1,agent-zed,4\n2,agent-zed,6\n3,agent-why,1" }),
    "facts.csv",
  );
  const out = makeTree({});
  await buildTimeline({ folder: dir, by: "issue", offline: true, facts }, out);
  return out;
}

export const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
].some((p) => existsSync(p));

export const canRender = CHROME && existsSync(join(defaultViewerDir(), "index.html"));
