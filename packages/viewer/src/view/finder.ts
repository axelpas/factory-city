/** A file of the frame under the playhead: its path and its index in the timeline's union of files. */
export interface FileEntry {
  path: string;
  union: number;
}

export interface FinderResult {
  matches: FileEntry[];
  /** How many files match in all, matches shown or not. */
  total: number;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Lower is better: the name starts with the first word, the name contains it, the path contains it. */
function rank(entry: FileEntry, words: string[]): number {
  const name = baseName(entry.path).toLowerCase();
  const first = words[0] ?? "";
  if (name.startsWith(first)) return 0;
  if (name.includes(first)) return 1;
  return 2;
}

/**
 * The files whose path contains every word of the query, best first: the keyboard path to a file of the
 * city. An empty query lists the files in path order.
 */
export function findFiles(entries: readonly FileEntry[], query: string, limit = 50): FinderResult {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = entries.filter((e) => {
    const path = e.path.toLowerCase();
    return words.every((w) => path.includes(w));
  });
  found.sort(
    (a, b) =>
      (words.length ? rank(a, words) - rank(b, words) : 0) ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path),
  );
  return { matches: found.slice(0, limit), total: found.length };
}
