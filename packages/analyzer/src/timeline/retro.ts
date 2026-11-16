import type { CcJson, Facts, Frame } from "@factory-city/schema";
import { bodyChecksum, nodeId } from "@factory-city/schema";
import type { Lineage } from "../collectors/lineage.js";
import type { Rev } from "./types.js";

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
