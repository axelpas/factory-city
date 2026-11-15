/** A block counts as copied from this many lines and tokens (the detector's own defaults). */
export const DUPLICATION_MIN_LINES = 5;
export const DUPLICATION_MIN_TOKENS = 50;

export interface DuplicationInput {
  path: string;
  text: string;
}

export interface FileDuplication {
  /** Lines of the file that also exist, as a block, somewhere else in the analyzed files. */
  lines: number;
  /** The file sharing the most lines with this one. */
  partner?: string;
}

interface Detection {
  detect(id: string, text: string, format: string): Promise<Clone[]>;
}

interface Clone {
  duplicationA: Side;
  duplicationB: Side;
}

interface Side {
  sourceId: string;
  start: { line: number };
  end: { line: number };
}

async function loadDetector(): Promise<{
  detector: Detection;
  formatOf: (path: string) => string | undefined;
}> {
  try {
    const core = await import("@jscpd/core");
    const tokenizer = await import("@jscpd/tokenizer");
    const detector = new core.Detector(new tokenizer.Tokenizer(), new core.MemoryStore(), [], {
      ...core.getDefaultOptions(),
      minLines: DUPLICATION_MIN_LINES,
      minTokens: DUPLICATION_MIN_TOKENS,
    });
    return { detector, formatOf: (path) => tokenizer.getFormatByFile(path) };
  } catch (err) {
    throw new Error(
      `Duplication needs the optional packages @jscpd/core and @jscpd/tokenizer, which are not installed (${
        err instanceof Error ? err.message : String(err)
      }). Install the dependencies without skipping the optional ones, or run without --with duplication.`,
    );
  }
}

/**
 * Copied blocks across the analyzed files, found in memory: nothing is written and no source text is kept,
 * only line numbers. A file in a format the detector does not know gets no entry: its duplication is
 * unavailable, not zero.
 */
export async function detectDuplication(
  files: readonly DuplicationInput[],
): Promise<Map<string, FileDuplication>> {
  const { detector, formatOf } = await loadDetector();
  const marked = new Map<string, Set<number>>();
  const shared = new Map<string, Map<string, number>>();
  const mark = (side: Side, other: string): void => {
    const lines = marked.get(side.sourceId);
    if (!lines) return;
    for (let line = side.start.line; line <= side.end.line; line++) lines.add(line);
    if (other === side.sourceId) return;
    const partners = shared.get(side.sourceId) ?? new Map<string, number>();
    partners.set(other, (partners.get(other) ?? 0) + side.end.line - side.start.line + 1);
    shared.set(side.sourceId, partners);
  };
  // a fixed order: the same files give the same result
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of ordered) {
    const format = formatOf(file.path);
    if (!format) continue;
    marked.set(file.path, new Set());
    for (const clone of await detector.detect(file.path, file.text, format)) {
      mark(clone.duplicationA, clone.duplicationB.sourceId);
      mark(clone.duplicationB, clone.duplicationA.sourceId);
    }
  }
  const result = new Map<string, FileDuplication>();
  for (const [path, lines] of marked) {
    const partners = [...(shared.get(path) ?? [])].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const partner = partners[0]?.[0];
    result.set(path, { lines: lines.size, ...(partner ? { partner } : {}) });
  }
  return result;
}
