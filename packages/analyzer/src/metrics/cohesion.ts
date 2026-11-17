import type { Node } from "web-tree-sitter";
import type { CohesionConfig } from "../languages/index.js";
import { linkUnits } from "./cohesion/links.js";
import { UnionFind } from "./cohesion/union-find.js";
import { readDeclarations } from "./cohesion/units.js";

export { leadingWord } from "./cohesion/units.js";

export interface Cohesion {
  groups: number;
  nodes: number;
  /** True when the file only re-exports: cohesion is not meaningful. */
  barrel: boolean;
  /** Names of the declarations of each group, largest group first. The report names groups by them. */
  names: string[][];
}

/**
 * LCOM4 generalized to a file (specification 6.5). Nodes are the top-level functions and the methods of
 * its classes, constructors excluded. Links come from references by name, shared declarations and shared
 * leading words in names. Returns undefined when the file has no function.
 */
export function computeCohesion(root: Node, cfg: CohesionConfig): Cohesion | undefined {
  const declarations = readDeclarations(root, cfg);
  const { units, statements, nonBarrel } = declarations;
  if (units.length === 0) return undefined;
  const uf = new UnionFind(units.length);
  linkUnits(declarations, uf, cfg);
  const byRoot = new Map<number, string[]>();
  let nodes = 0;
  units.forEach((u, i) => {
    // a method of a type declared in another file cannot be rated here: its fields are elsewhere
    if (u.owner && !declarations.owned.has(u.owner)) return;
    nodes++;
    const root = uf.find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), u.name]);
  });
  const names = [...byRoot.values()].sort(
    (a, b) => b.length - a.length || ((a[0] as string) < (b[0] as string) ? -1 : 1),
  );
  if (nodes === 0) return undefined;
  return { groups: byRoot.size, nodes, barrel: statements > 0 && nonBarrel === 0, names };
}
