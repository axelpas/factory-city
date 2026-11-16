import type { CohesionConfig } from "../../languages/index.js";
import type { UnionFind } from "./union-find.js";
import { type Declarations, leadingWord } from "./units.js";

/** Joins each unit to the first one that used the key, so that all the users of a key end in one group. */
function joinByKey(uf: UnionFind, first: Map<string, number>, key: string, i: number): void {
  const earlier = first.get(key);
  if (earlier === undefined) first.set(key, i);
  else uf.union(i, earlier);
}

/** 1. A function references another function of the file. */
function byReference({ units }: Declarations, uf: UnionFind): void {
  const byName = new Map<string, number>();
  units.forEach((u, i) => {
    if (!u.owner) byName.set(u.name, i);
  });
  units.forEach((u, i) => {
    for (const token of u.tokens) {
      const target = byName.get(token);
      if (target !== undefined && target !== i) uf.union(i, target);
    }
  });
}

/** 2. Functions that use the same variable, type or class declared in the file. */
function bySharedDeclaration({ units, declared }: Declarations, uf: UnionFind): void {
  const users = new Map<string, number>();
  units.forEach((u, i) => {
    for (const token of u.tokens) if (declared.has(token)) joinByKey(uf, users, token, i);
  });
}

/** 3. Methods of one class: calls between methods and shared fields, through `this.`. */
function byClass({ units, classMembers }: Declarations, uf: UnionFind): void {
  const fieldUsers = new Map<string, number>();
  units.forEach((u, i) => {
    const cls = u.owner ? classMembers.get(u.owner) : undefined;
    if (!u.owner || !cls) return;
    for (const member of u.selfTokens) {
      const method = cls.methods.get(member);
      if (method !== undefined && method !== i) uf.union(i, method);
      if (cls.fields.has(member)) joinByKey(uf, fieldUsers, `${u.owner}.${member}`, i);
    }
  });
}

/** 4. Functions sharing a leading word in their names: sibling components, themed helpers. */
function byLeadingWord({ units }: Declarations, uf: UnionFind, cfg: CohesionConfig): void {
  const stems = new Map<string, number>();
  units.forEach((u, i) => {
    const simple = u.owner ? u.name.slice(u.owner.length + 1) : u.name;
    const word = leadingWord(simple);
    if (word.length >= cfg.minStemLength) joinByKey(uf, stems, `${u.owner ?? ""}:${word}`, i);
  });
  const topNames = units.map((u, i) => [u, i] as const).filter(([u]) => !u.owner);
  for (const [a, i] of topNames) {
    if (a.name.length < cfg.minStemLength) continue;
    for (const [b, j] of topNames) if (i !== j && b.name.startsWith(a.name)) uf.union(i, j);
  }
}

/** Joins the units that belong together, by the four kinds of link. */
export function linkUnits(d: Declarations, uf: UnionFind, cfg: CohesionConfig): void {
  byReference(d, uf);
  bySharedDeclaration(d, uf);
  byClass(d, uf);
  byLeadingWord(d, uf, cfg);
}
