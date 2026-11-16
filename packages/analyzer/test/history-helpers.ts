import { mkdirSync, renameSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import type { analyze } from "../src/analyze.js";

import { commitAt, initRepo } from "./helpers.js";

export type Result = Awaited<ReturnType<typeof analyze>>;

export function values(result: Result): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const walk = (nodes: Result["snapshot"]["files"], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === "File")
        out.set(p.replace(/^root\//, ""), result.snapshot.lenses.metrics.attributes[n.id] ?? {});
      else walk(n.children ?? [], p);
    }
  };
  walk(result.snapshot.files, "");
  return out;
}

export const body = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;

/** Five dated commits; c1..c5 are their hashes. */

export function syntheticRepo() {
  const dir = initRepo();
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("src/a.ts", body(2));
  write("src/b.ts", body(2));
  const c1 = commitAt(dir, "2026-01-01T10:00:00Z", "feat: start (#1)", "Ann <ann@example.com>");
  write("src/a.ts", body(4));
  const c2 = commitAt(dir, "2026-01-10T10:00:00Z", "fix(core): repair a (#2)", "Bob <bob@example.com>");
  write("src/a.ts", body(5));
  write("src/c.ts", body(1));
  const c3 = commitAt(dir, "2026-03-01T10:00:00Z", "feat: add c (#3)", "Ann <ann@example.com>");
  renameSync(join(dir, "src/b.ts"), join(dir, "src/renamed.ts"));
  const c4 = commitAt(dir, "2026-03-05T10:00:00Z", "refactor: rename b", "Ann <ann@example.com>");
  write("src/a.ts", body(6));
  const c5 = commitAt(dir, "2026-03-20T10:00:00Z", "hotfix: urgent repair of a", "Bob <bob@example.com>");
  return { dir, c1, c2, c3, c4, c5 };
}
