import type { HiddenLink } from "@factory-city/schema";
import type { HealthExtras } from "./types.js";

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Files that change together without a link in the imports, in other folders. */
function coChangeLinks(extras: HealthExtras): HiddenLink[] {
  const imports = extras.imports ?? [];
  const linked = new Set(imports.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
  return (extras.coChange ?? [])
    .filter(([a, b]) => folderOf(a) !== folderOf(b) && !linked.has(`${a}\0${b}`))
    .map(([a, b]) => ({
      kind: "co-change-without-import",
      files: [a, b].sort(),
      detail: "These files change together but neither imports the other.",
    }));
}

interface Spread {
  own: number;
  elsewhere: Map<string, number>;
}

/** For each file, how many of its imports stay in its folder and how many go to each other folder. */
function importSpread(imports: ReadonlyArray<readonly [string, string]>): Map<string, Spread> {
  const byFile = new Map<string, Spread>();
  for (const [from, to] of imports) {
    const entry = byFile.get(from) ?? { own: 0, elsewhere: new Map<string, number>() };
    if (folderOf(to) === folderOf(from)) entry.own++;
    else entry.elsewhere.set(folderOf(to), (entry.elsewhere.get(folderOf(to)) ?? 0) + 1);
    byFile.set(from, entry);
  }
  return byFile;
}

/** The other folder that gets most of a file's imports, with how many. */
function topFolder(entry: Spread): [string, number] {
  const sorted = [...entry.elsewhere].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return sorted[0] ?? ["", 0];
}

function importsElsewhere(extras: HealthExtras): HiddenLink[] {
  const out: HiddenLink[] = [];
  for (const [file, entry] of importSpread(extras.imports ?? [])) {
    const [folder, count] = topFolder(entry);
    const total = entry.own + [...entry.elsewhere.values()].reduce((a, b) => a + b, 0);
    if (total < 4 || count <= entry.own || count / total <= 0.5) continue;
    out.push({
      kind: "imports-mostly-elsewhere",
      files: [file],
      detail: `${count} of its ${total} imports go to ${folder || "the root folder"}: it may belong there.`,
    });
  }
  return out;
}

/** Experimental: links between files that the folder structure and the imports do not show. */
export function findHiddenLinks(extras: HealthExtras, limit = 10): HiddenLink[] {
  return [...coChangeLinks(extras), ...importsElsewhere(extras)]
    .sort((x, y) => (x.files.join() < y.files.join() ? -1 : 1))
    .slice(0, limit);
}
