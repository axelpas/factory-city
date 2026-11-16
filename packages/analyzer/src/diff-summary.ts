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

type Attrs = Map<string, Record<string, number>>;
type Values = Record<string, number> | undefined;

/** Files, real lines and complexity of a snapshot. */
function totalsOf(m: Attrs) {
  let rloc = 0;
  let mcc = 0;
  for (const v of m.values()) {
    rloc += v.rloc ?? 0;
    mcc += v.mcc ?? 0;
  }
  return { files: m.size, rloc, mcc };
}

/** Whether a metric counts one kind of silenced check (not the total or the density). */
function isShortcutKind(key: string): boolean {
  return key.startsWith("escape_") && key !== "escape_hatches" && key !== "escape_hatch_density";
}

/** The change of each kind of silenced check in one file, added to the running total by kind. */
function addShortcutKinds(byKind: Record<string, number>, a: Values, b: Values): void {
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (!isShortcutKind(key)) continue;
    const delta = (b?.[key] ?? 0) - (a?.[key] ?? 0);
    if (delta !== 0) byKind[key.slice(7)] = (byKind[key.slice(7)] ?? 0) + delta;
  }
}

/** Whether a file that exists on both sides changed: its real lines, its complexity or its line count. */
function isTouched(a: NonNullable<Values>, b: NonNullable<Values>): boolean {
  return (a.rloc ?? 0) !== (b.rloc ?? 0) || (a.mcc ?? 0) !== (b.mcc ?? 0) || (a.loc ?? 0) !== (b.loc ?? 0);
}

/** What happened to a file between the base and the head: added, removed, modified, or nothing. */
function changeOf(path: string, a: Values, b: Values): DiffFileChange | undefined {
  const rloc = (b?.rloc ?? 0) - (a?.rloc ?? 0);
  const mcc = (b?.mcc ?? 0) - (a?.mcc ?? 0);
  if (!a) return { path, status: "added", rloc, mcc };
  if (!b) return { path, status: "removed", rloc, mcc };
  return isTouched(a, b) ? { path, status: "modified", rloc, mcc } : undefined;
}

/** The quality score of each side and the hotspots that appeared and went. */
function qualityOf(base: Side, head: Side) {
  const b = base.health?.score ?? 0;
  const h = head.health?.score ?? 0;
  const baseHotspots = base.health?.hotspots ?? [];
  const headHotspots = head.health?.hotspots ?? [];
  return {
    quality: { base: b, head: h, delta: Math.round((h - b) * 10) / 10 },
    hotspots: {
      created: headHotspots.filter((p) => !baseHotspots.includes(p)),
      resolved: baseHotspots.filter((p) => !headHotspots.includes(p)),
    },
  };
}

export function summarize(project: string, base: Side, head: Side, top = 10): DiffSummary {
  const before = attributesByPath(base.cc);
  const after = attributesByPath(head.cc);
  const changes: DiffFileChange[] = [];
  const files = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const byKind: Record<string, number> = {};
  let shortcuts = 0;
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    addShortcutKinds(byKind, a, b);
    shortcuts += (b?.escape_hatches ?? 0) - (a?.escape_hatches ?? 0);
    const change = changeOf(path, a, b);
    if (change) changes.push(change);
    files[change ? change.status : "unchanged"]++;
  }
  const weight = (c: DiffFileChange) => Math.abs(c.rloc) + Math.abs(c.mcc);
  changes.sort((x, y) => weight(y) - weight(x) || (x.path < y.path ? -1 : 1));
  const tb = totalsOf(before);
  const th = totalsOf(after);
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
    ...qualityOf(base, head),
  };
}

export { diffText } from "./diff-text.js";
