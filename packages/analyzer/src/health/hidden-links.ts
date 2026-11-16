import type { HiddenLink } from "@factory-city/schema";
import type { HealthExtras } from "./types.js";

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Experimental: links between files that the folder structure and the imports do not show. */
export function findHiddenLinks(extras: HealthExtras, limit = 10): HiddenLink[] {
  const out: HiddenLink[] = [];
  const imports = extras.imports ?? [];
  const linked = new Set(imports.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
  for (const [a, b] of extras.coChange ?? []) {
    if (folderOf(a) === folderOf(b) || linked.has(`${a}\0${b}`)) continue;
    out.push({
      kind: "co-change-without-import",
      files: [a, b].sort(),
      detail: "These files change together but neither imports the other.",
    });
  }
  const byFile = new Map<string, { own: number; elsewhere: Map<string, number> }>();
  for (const [from, to] of imports) {
    const entry = byFile.get(from) ?? { own: 0, elsewhere: new Map<string, number>() };
    if (folderOf(to) === folderOf(from)) entry.own++;
    else entry.elsewhere.set(folderOf(to), (entry.elsewhere.get(folderOf(to)) ?? 0) + 1);
    byFile.set(from, entry);
  }
  for (const [file, entry] of byFile) {
    const [folder, count] = [...entry.elsewhere].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0] ?? [
      "",
      0,
    ];
    const total = entry.own + [...entry.elsewhere.values()].reduce((a, b) => a + b, 0);
    if (total >= 4 && count > entry.own && count / total > 0.5) {
      out.push({
        kind: "imports-mostly-elsewhere",
        files: [file],
        detail: `${count} of its ${total} imports go to ${folder || "the root folder"}: it may belong there.`,
      });
    }
  }
  return out.sort((x, y) => (x.files.join() < y.files.join() ? -1 : 1)).slice(0, limit);
}
