import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import type { CcJson } from "@factory-city/schema";

import { commitAt, initRepo } from "./helpers.js";

export const body = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;

export function repo() {
  const dir = initRepo();
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("src/a.ts", body(2));
  commitAt(dir, "2026-01-01T09:00:00Z", "feat: start");
  write("src/b.ts", body(3));
  commitAt(dir, "2026-01-01T15:00:00Z", "feat(core): add b");
  write("src/a.ts", body(5));
  commitAt(dir, "2026-01-02T10:00:00Z", "fix: repair a");
  rmSync(join(dir, "src/b.ts"));
  write("src/c.ts", body(1));
  commitAt(dir, "2026-01-04T10:00:00Z", "refactor: replace b by c");
  return dir;
}

export function attrsByPath(cc: CcJson): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const walk = (nodes: CcJson["files"], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === "File") out.set(p.replace(/^root\//, ""), cc.lenses.metrics.attributes[n.id] ?? {});
      else walk(n.children ?? [], p);
    }
  };
  walk(cc.files, "");
  return out;
}

export const read = (dir: string, rel: string) => JSON.parse(readFileSync(join(dir, rel), "utf8")) as CcJson;
