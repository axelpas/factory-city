import type { CcJson, Facts, Frame, FrameHealth } from "@factory-city/schema";
import { bodyChecksum, nodeId } from "@factory-city/schema";
import type { RawCommit } from "../collectors/history.js";
import type { Lineage } from "../collectors/lineage.js";
import type { Rev } from "./types.js";

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

/** The fact that belongs to a frame: by its issue number, else by its commit. */
export function factOf(facts: Facts, rev: Rev) {
  const number = rev.meta?.issue?.number;
  return facts.facts.find(
    (f) =>
      (number !== undefined && f.issue === number) ||
      (f.commit !== undefined && rev.hash.startsWith(f.commit)),
  );
}

/** Experimental: the cost of the issues that touched each file, written into the snapshot as `cost_share`. */
export function writeCostShares(snapshot: CcJson, costByFile: Map<string, number>): void {
  const lens = snapshot.lenses.metrics;
  for (const [path, cost] of costByFile) {
    const values = lens.attributes[nodeId(`/root/${path}`)];
    if (values) values.cost_share = Math.round(cost * 100) / 100;
  }
  lens.attributeDescriptors.cost_share = {
    title: "Cost share",
    description: "Cost of the issues that touched the file",
    analyzers: ["factory-city"],
  };
  lens.attributeTypes.cost_share = "absolute";
  snapshot.meta.checksum = bodyChecksum(snapshot.files, snapshot.lenses);
}

/** Retrospective metrics: what later happened to the lines each frame added. */
export function addRetrospective(frames: Frame[], revs: Rev[], lineage: Lineage): void {
  let previous = -1;
  for (const [i, rev] of revs.entries()) {
    const at = lineage.stepIndex.get(rev.hash);
    const frame = frames[i];
    if (at === undefined || !frame) continue;
    const indices: number[] = [];
    for (let k = previous + 1; k <= at; k++) indices.push(k);
    previous = Math.max(previous, at);
    const retro = lineage.provenance.retrospective(indices, rev.time);
    frame.metrics.caused_fixes = retro.caused_fixes;
    frame.metrics.lines_written = retro.lines_added;
    if (retro.alive_30 !== undefined) frame.metrics.alive_30 = retro.alive_30;
    if (retro.alive_90 !== undefined) frame.metrics.alive_90 = retro.alive_90;
    if (retro.rework_after !== undefined) frame.metrics.rework_after = retro.rework_after;
    else if (retro.lines_added > 0) frame.metrics.rework_after_pending = true;
  }
}
