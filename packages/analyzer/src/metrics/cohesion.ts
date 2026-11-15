import type { Node } from "web-tree-sitter";
import type { CohesionConfig } from "../languages/index.js";

export interface Cohesion {
  groups: number;
  nodes: number;
  /** True when the file only re-exports: cohesion is not meaningful. */
  barrel: boolean;
  /** Names of the declarations of each group, largest group first. The report names groups by them. */
  names: string[][];
}

interface Unit {
  name: string;
  /** Names of the class this unit belongs to, when it is a method. */
  owner?: string;
  tokens: Set<string>;
  /** Members used through `this.`. */
  selfTokens: Set<string>;
}

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    let cur = i;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur] as number;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
  count(): number {
    return new Set(this.parent.map((_, i) => this.find(i))).size;
  }
}

/** The first word of an identifier: `formatDate` gives `format`, `CardHeader` gives `Card`. */
export function leadingWord(name: string): string {
  const m = /^[a-z0-9]+|^[A-Z][a-z0-9]*|^[A-Z]+(?![a-z])/.exec(name);
  return m ? m[0] : name;
}

function collect(node: Node, cfg: CohesionConfig, tokens: Set<string>, selfTokens: Set<string>): void {
  if (cfg.identifiers.includes(node.type)) tokens.add(node.text);
  if (node.type === cfg.memberExpression) {
    const object = node.childForFieldName("object");
    const property = node.childForFieldName("property");
    if (object?.text === cfg.selfObject && property) selfTokens.add(property.text);
  }
  for (const child of node.namedChildren) if (child) collect(child, cfg, tokens, selfTokens);
}

function unitOf(node: Node, name: string, owner: string | undefined, cfg: CohesionConfig): Unit {
  const tokens = new Set<string>();
  const selfTokens = new Set<string>();
  collect(node, cfg, tokens, selfTokens);
  tokens.delete(name);
  return { name, owner, tokens, selfTokens };
}

/**
 * LCOM4 generalized to a file (specification 6.5). Nodes are the top-level functions and the methods of
 * its classes, constructors excluded. Links come from references by name, shared declarations and shared
 * leading words in names. Returns undefined when the file has no function.
 */
export function computeCohesion(root: Node, cfg: CohesionConfig): Cohesion | undefined {
  const units: Unit[] = [];
  const declared = new Set<string>();
  const classMembers = new Map<string, { methods: Map<string, number>; fields: Set<string> }>();
  let statements = 0;
  let nonBarrel = 0;

  const unwrap = (node: Node): Node => {
    if (!cfg.wrappers.includes(node.type)) return node;
    return node.childForFieldName("declaration") ?? node;
  };

  for (const top of root.namedChildren) {
    if (!top || top.type === "comment") continue;
    statements++;
    const isBarrelStatement =
      cfg.barrelStatements.includes(top.type) &&
      !top.childForFieldName("declaration") &&
      !top.childForFieldName("value");
    if (!isBarrelStatement) nonBarrel++;
    const node = unwrap(top);
    const nameField = node.childForFieldName("name")?.text;
    if (cfg.functionDeclarations.includes(node.type) && nameField) {
      units.push(unitOf(node, nameField, undefined, cfg));
    } else if (cfg.variableDeclarations.includes(node.type)) {
      for (const decl of node.namedChildren) {
        if (decl?.type !== "variable_declarator") continue;
        const name = decl.childForFieldName("name")?.text;
        const value = decl.childForFieldName("value");
        if (!name) continue;
        if (value && cfg.functionValues.includes(value.type)) units.push(unitOf(value, name, undefined, cfg));
        else declared.add(name);
      }
    } else if (cfg.classDeclarations.includes(node.type) && nameField) {
      declared.add(nameField);
      const members = { methods: new Map<string, number>(), fields: new Set<string>() };
      classMembers.set(nameField, members);
      const body = node.childForFieldName("body");
      for (const member of body?.namedChildren ?? []) {
        if (!member) continue;
        const memberName = member.childForFieldName("name")?.text;
        if (!memberName) continue;
        if (cfg.methods.includes(member.type) && memberName !== cfg.constructorName) {
          members.methods.set(memberName, units.length);
          units.push(unitOf(member, `${nameField}.${memberName}`, nameField, cfg));
        } else if (cfg.fields.includes(member.type)) {
          members.fields.add(memberName);
        }
      }
    } else if (cfg.otherDeclarations.includes(node.type) && nameField) {
      declared.add(nameField);
    }
  }

  if (units.length === 0) return undefined;
  const barrel = statements > 0 && nonBarrel === 0;
  const uf = new UnionFind(units.length);

  // 1. a function references another function of the file
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

  // 2. functions that use the same variable, type or class declared in the file
  const users = new Map<string, number>();
  units.forEach((u, i) => {
    for (const token of u.tokens) {
      if (!declared.has(token)) continue;
      const first = users.get(token);
      if (first === undefined) users.set(token, i);
      else uf.union(i, first);
    }
  });

  // 3. methods of one class: calls between methods and shared fields, through `this.`
  const fieldUsers = new Map<string, number>();
  units.forEach((u, i) => {
    const cls = u.owner ? classMembers.get(u.owner) : undefined;
    if (!u.owner || !cls) return;
    for (const member of u.selfTokens) {
      const method = cls.methods.get(member);
      if (method !== undefined && method !== i) uf.union(i, method);
      if (cls.fields.has(member)) {
        const key = `${u.owner}.${member}`;
        const first = fieldUsers.get(key);
        if (first === undefined) fieldUsers.set(key, i);
        else uf.union(i, first);
      }
    }
  });

  // 4. functions sharing a leading word in their names: sibling components, themed helpers
  const stems = new Map<string, number>();
  units.forEach((u, i) => {
    const simple = u.owner ? u.name.slice(u.owner.length + 1) : u.name;
    const word = leadingWord(simple);
    if (word.length < cfg.minStemLength) return;
    const key = `${u.owner ?? ""}:${word}`;
    const first = stems.get(key);
    if (first === undefined) stems.set(key, i);
    else uf.union(i, first);
  });
  const topNames = units.map((u, i) => [u, i] as const).filter(([u]) => !u.owner);
  for (const [a, i] of topNames) {
    if (a.name.length < cfg.minStemLength) continue;
    for (const [b, j] of topNames) if (i !== j && b.name.startsWith(a.name)) uf.union(i, j);
  }

  const byRoot = new Map<number, string[]>();
  units.forEach((u, i) => {
    const root = uf.find(i);
    const list = byRoot.get(root);
    if (list) list.push(u.name);
    else byRoot.set(root, [u.name]);
  });
  const names = [...byRoot.values()].sort(
    (a, b) => b.length - a.length || ((a[0] as string) < (b[0] as string) ? -1 : 1),
  );
  return { groups: uf.count(), nodes: units.length, barrel, names };
}
