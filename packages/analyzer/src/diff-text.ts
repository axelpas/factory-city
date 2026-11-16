import type { DiffSummary } from "@factory-city/schema";

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

/** The summary as a few lines of text. */
export function diffText(s: DiffSummary): string {
  if (s.base.commit === s.head.commit) return `No change: ${s.head.rev} is at its base (${s.base.commit}).`;
  const f = s.files;
  const lines = [
    `${s.head.rev} (${s.head.commit}) against ${s.base.commit}: ${f.added} files added, ${f.modified} changed, ${f.removed} removed.`,
    `Real lines ${signed(s.totals.delta.rloc)}, complexity ${signed(s.totals.delta.mcc)}, silenced checks ${signed(s.shortcuts.added)}.`,
    `Score ${s.quality.head} out of 100 (${signed(s.quality.delta)}); hotspots created: ${s.hotspots.created.length}, resolved: ${s.hotspots.resolved.length}.`,
  ];
  if (f.added + f.modified + f.removed === 0) lines.push("No source file changed.");
  for (const c of s.biggest.slice(0, 5))
    lines.push(`  ${c.status.padEnd(8)} ${c.path}  lines ${signed(c.rloc)}, complexity ${signed(c.mcc)}`);
  return lines.join("\n");
}
