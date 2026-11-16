import type { CcJson, DiffFileChange, DiffSummary, FrameHealth } from "@factory-city/schema";

function attributesByPath(cc: CcJson): Map<string, Record<string, number>> {
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

/** What a branch does to the city, from the snapshots of its base and of its head. */
export type Side = { rev: string; commit: string; cc: CcJson; health?: FrameHealth };

export function summarize(project: string, base: Side, head: Side, top = 10): DiffSummary {
  const before = attributesByPath(base.cc);
  const after = attributesByPath(head.cc);
  const changes: DiffFileChange[] = [];
  const files = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const byKind: Record<string, number> = {};
  let shortcuts = 0;
  const totals = (m: Map<string, Record<string, number>>) => {
    let rloc = 0;
    let mcc = 0;
    for (const v of m.values()) {
      rloc += v.rloc ?? 0;
      mcc += v.mcc ?? 0;
    }
    return { files: m.size, rloc, mcc };
  };
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    const rloc = (b?.rloc ?? 0) - (a?.rloc ?? 0);
    const mcc = (b?.mcc ?? 0) - (a?.mcc ?? 0);
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (!key.startsWith("escape_") || key === "escape_hatches" || key === "escape_hatch_density") continue;
      const delta = (b?.[key] ?? 0) - (a?.[key] ?? 0);
      if (delta !== 0) byKind[key.slice(7)] = (byKind[key.slice(7)] ?? 0) + delta;
    }
    shortcuts += (b?.escape_hatches ?? 0) - (a?.escape_hatches ?? 0);
    if (!a) {
      files.added++;
      changes.push({ path, status: "added", rloc, mcc });
    } else if (!b) {
      files.removed++;
      changes.push({ path, status: "removed", rloc, mcc });
    } else if (rloc !== 0 || mcc !== 0 || (a.loc ?? 0) !== (b.loc ?? 0)) {
      files.modified++;
      changes.push({ path, status: "modified", rloc, mcc });
    } else files.unchanged++;
  }
  const weight = (c: DiffFileChange) => Math.abs(c.rloc) + Math.abs(c.mcc);
  changes.sort((x, y) => weight(y) - weight(x) || (x.path < y.path ? -1 : 1));
  const tb = totals(before);
  const th = totals(after);
  return {
    kind: "diff",
    schemaVersion: 1,
    project,
    base: { rev: base.rev, commit: base.commit },
    head: { rev: head.rev, commit: head.commit },
    files,
    totals: {
      base: tb,
      head: th,
      delta: { files: th.files - tb.files, rloc: th.rloc - tb.rloc, mcc: th.mcc - tb.mcc },
    },
    shortcuts: { added: shortcuts, byKind },
    biggest: changes.slice(0, top),
    quality: {
      base: base.health?.score ?? 0,
      head: head.health?.score ?? 0,
      delta: Math.round(((head.health?.score ?? 0) - (base.health?.score ?? 0)) * 10) / 10,
    },
    hotspots: {
      created: (head.health?.hotspots ?? []).filter((p) => !(base.health?.hotspots ?? []).includes(p)),
      resolved: (base.health?.hotspots ?? []).filter((p) => !(head.health?.hotspots ?? []).includes(p)),
    },
  };
}

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
