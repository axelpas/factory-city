import type { CcJson, FrameHealth } from "@factory-city/schema";
import type { RawCommit } from "../collectors/history.js";

/** The files added, modified and deleted since the previous frame, by blob id. */
export function diffBlobs(blobs: Map<string, string>, previous: Map<string, string>) {
  const added: string[] = [];
  const modified: string[] = [];
  for (const [path, blob] of blobs) {
    const before = previous.get(path);
    if (before === undefined) added.push(path);
    else if (before !== blob) modified.push(path);
  }
  const deleted = [...previous.keys()].filter((p) => !blobs.has(p));
  return { added, modified, deleted };
}

/**
 * Lines added and deleted by the commits a frame brings, in all and per file of the analyzed folder. A
 * folder prefix keeps the files under it and shows their paths relative to it.
 */
export function lineChanges(
  newCommits: string[],
  byHash: Map<string, RawCommit>,
  prefix: string,
  blobs: Map<string, string>,
  previousBlobs: Map<string, string>,
) {
  let linesAdded = 0;
  let linesDeleted = 0;
  const lines: Record<string, [number, number]> = {};
  const cut = prefix ? prefix.length + 1 : 0;
  for (const hash of newCommits) {
    for (const change of byHash.get(hash)?.changes ?? []) {
      linesAdded += change.added;
      linesDeleted += change.deleted;
      if (prefix && !change.path.startsWith(`${prefix}/`)) continue;
      const rel = change.path.slice(cut);
      if (!blobs.has(rel) && !previousBlobs.has(rel)) continue;
      const entry = lines[rel] ?? [0, 0];
      lines[rel] = [entry[0] + change.added, entry[1] + change.deleted];
    }
  }
  return { linesAdded, linesDeleted, lines };
}

/** Files, real lines and complexity of a snapshot: the totals shown on the timeline bar. */
export function snapshotTotals(snapshot: CcJson) {
  const totals = { files: 0, rloc: 0, mcc: 0 };
  for (const values of Object.values(snapshot.lenses.metrics.attributes)) {
    if (values.loc === undefined) continue;
    totals.files++;
    totals.rloc += values.rloc ?? 0;
    totals.mcc += values.mcc ?? 0;
  }
  return totals;
}

/** What a frame did to the code health since the previous one; nothing to say for the first frame. */
export function qualityChange(
  health: FrameHealth,
  shortcutCount: number,
  previous: FrameHealth | undefined,
  previousShortcuts: number,
) {
  if (previous === undefined) return {};
  return {
    quality_delta: Math.round((health.score - previous.score) * 10) / 10,
    hotspots_created: health.hotspots.filter((p) => !previous.hotspots.includes(p)).length,
    hotspots_resolved: previous.hotspots.filter((p) => !health.hotspots.includes(p)).length,
    shortcuts_added: shortcutCount - previousShortcuts,
  };
}
