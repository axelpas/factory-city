import { writeFileSync } from "node:fs";

import { join } from "node:path";

import type { CcJson } from "@factory-city/schema";

import type { Step } from "../src/collectors/steps.js";

import { commitAt, initRepo } from "./helpers.js";

export const CLAUDE = "\n\nCo-Authored-By: Agent One <one@example.com>";

export const lines = (...l: string[]) => `${l.join("\n")}\n`;

export function attrs(cc: CcJson): Map<string, Record<string, number>> {
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

export function step(time: number, patch: Partial<Step> = {}): Step {
  return {
    hash: `h${time}`,
    parents: [],
    time: time * 86400,
    subject: "feat: x",
    body: "",
    authorName: "A",
    authorEmail: "a@example.com",
    merged: [],
    link: { strategy: "unlinked" },
    isFix: false,
    ...patch,
  };
}

export function syntheticRepo() {
  const dir = initRepo();
  const a = (...l: string[]) =>
    writeFileSync(join(dir, "a.ts"), lines(...l.map((x) => `export const ${x} = 1;`)));
  a("a1", "a2", "a3", "a4", "a5", "a6");
  writeFileSync(
    join(dir, "b.ts"),
    lines("export const b1 = 1;", "--- not a header", "+++ nor this", "@@ -1 +1 @@ nor that"),
  );
  const c1 = commitAt(dir, "2026-01-01T10:00:00Z", `feat: start (#1)${CLAUDE}`);
  a("r1", "r2", "a3", "a4", "a5", "a6");
  const c2 = commitAt(dir, "2026-01-04T10:00:00Z", `feat: early rewrite (#2)${CLAUDE}`);
  a("r1", "r2", "a3", "a4", "late5", "late6");
  writeFileSync(
    join(dir, "b.ts"),
    lines("export const b1 = 2;", "--- still not a header", "+++ nor this", "@@ -1 +1 @@ nor that"),
  );
  const c3 = commitAt(
    dir,
    "2026-01-31T10:00:00Z",
    "feat: late rewrite (#3)\n\nCo-Authored-By: Agent Two <two@example.com>",
  );
  a("r1", "r2", "fixed3", "a4", "late5", "late6");
  const c4 = commitAt(dir, "2026-02-01T10:00:00Z", "fix: repair line three (#4)");
  return { dir, c1, c2, c3, c4 };
}
