import type { Node } from "web-tree-sitter";
import type { CohesionConfig } from "../../languages/index.js";

/** A function or a method of the file, with the names it uses. */
export interface Unit {
  name: string;
  /** Names of the class this unit belongs to, when it is a method. */
  owner?: string;
  tokens: Set<string>;
  /** Members used through `this.`. */
  selfTokens: Set<string>;
}

export interface ClassMembers {
  methods: Map<string, number>;
  fields: Set<string>;
}

/** What the top level of a file declares. */
export interface Declarations {
  units: Unit[];
  declared: Set<string>;
  classMembers: Map<string, ClassMembers>;
  statements: number;
  nonBarrel: number;
}

/** The first word of an identifier: `formatDate` gives `format`, `CardHeader` gives `Card`. */
export function leadingWord(name: string): string {
  const m = /^[a-z0-9]+|^[A-Z][a-z0-9]*|^[A-Z]+(?![a-z])/.exec(name);
  return m ? m[0] : name;
}

function collect(node: Node, cfg: CohesionConfig, tokens: Set<string>, selfTokens: Set<string>): void {
  if (cfg.identifiers.includes(node.type)) tokens.add(node.text);
  if (node.type === cfg.memberExpression) {
    const object = node.childForFieldName(cfg.memberObjectField ?? "object");
    const property = node.childForFieldName(cfg.memberPropertyField ?? "property");
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

function unwrap(node: Node, cfg: CohesionConfig): Node {
  if (!cfg.wrappers.includes(node.type)) return node;
  return node.childForFieldName(cfg.wrapperField ?? "declaration") ?? node;
}

/** A statement that only re-exports: no declaration and no value of its own. */
function isBarrelStatement(top: Node, cfg: CohesionConfig): boolean {
  return (
    cfg.barrelStatements.includes(top.type) &&
    !top.childForFieldName("declaration") &&
    !top.childForFieldName("value")
  );
}

/** The functions and the names declared by `const name = ...`. */
function addVariables(node: Node, d: Declarations, cfg: CohesionConfig): void {
  for (const decl of node.namedChildren) {
    if (decl?.type !== "variable_declarator") continue;
    const name = decl.childForFieldName("name")?.text;
    const value = decl.childForFieldName("value");
    if (!name) continue;
    if (value && cfg.functionValues.includes(value.type)) d.units.push(unitOf(value, name, undefined, cfg));
    else d.declared.add(name);
  }
}

/** The name a `name = value` statement declares, in the languages where a statement does it. */
function assignedName(statement: Node, cfg: CohesionConfig): string | undefined {
  const a = cfg.assignments;
  if (!a || statement.type !== a.statement) return undefined;
  const assignment = statement.namedChildren.find((c) => c?.type === a.node);
  const name = assignment?.childForFieldName(a.nameField);
  return name?.type === "identifier" ? name.text : undefined;
}

/** A class: its methods become units, its fields are kept to link the methods that share them. */
function addClass(node: Node, name: string, d: Declarations, cfg: CohesionConfig): void {
  d.declared.add(name);
  const members: ClassMembers = { methods: new Map(), fields: new Set() };
  d.classMembers.set(name, members);
  for (const raw of node.childForFieldName("body")?.namedChildren ?? []) {
    const assigned = raw ? assignedName(raw, cfg) : undefined;
    if (assigned) {
      members.fields.add(assigned);
      continue;
    }
    const member = raw ? unwrap(raw, cfg) : undefined;
    const memberName = member?.childForFieldName("name")?.text;
    if (!member || !memberName) continue;
    if (cfg.methods.includes(member.type) && memberName !== cfg.constructorName) {
      members.methods.set(memberName, d.units.length);
      d.units.push(unitOf(member, `${name}.${memberName}`, name, cfg));
    } else if (cfg.methods.includes(member.type) && cfg.fieldsFromConstructor) {
      // the members the constructor sets on the self object are the fields of the class
      for (const field of unitOf(member, memberName, name, cfg).selfTokens) members.fields.add(field);
    } else if (cfg.fields.includes(member.type)) {
      members.fields.add(memberName);
    }
  }
}

function addDeclaration(top: Node, d: Declarations, cfg: CohesionConfig): void {
  const assigned = assignedName(top, cfg);
  if (assigned) {
    d.declared.add(assigned);
    return;
  }
  const node = unwrap(top, cfg);
  const name = node.childForFieldName("name")?.text;
  if (cfg.functionDeclarations.includes(node.type) && name) d.units.push(unitOf(node, name, undefined, cfg));
  else if (cfg.variableDeclarations.includes(node.type)) addVariables(node, d, cfg);
  else if (cfg.classDeclarations.includes(node.type) && name) addClass(node, name, d, cfg);
  else if (cfg.otherDeclarations.includes(node.type) && name) d.declared.add(name);
}

/** Reads the top level of a file: its functions and methods, and the names it declares. */
export function readDeclarations(root: Node, cfg: CohesionConfig): Declarations {
  const d: Declarations = {
    units: [],
    declared: new Set(),
    classMembers: new Map(),
    statements: 0,
    nonBarrel: 0,
  };
  for (const top of root.namedChildren) {
    if (!top || top.type === "comment") continue;
    d.statements++;
    if (!isBarrelStatement(top, cfg)) d.nonBarrel++;
    addDeclaration(top, d, cfg);
  }
  return d;
}
