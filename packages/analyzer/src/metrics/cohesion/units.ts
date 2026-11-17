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

function collect(
  node: Node,
  cfg: CohesionConfig,
  tokens: Set<string>,
  selfTokens: Set<string>,
  self: string,
  skip?: Node,
): void {
  if (skip && node.id === skip.id) return;
  if (cfg.identifiers.includes(node.type)) tokens.add(node.text);
  if (node.type === cfg.memberExpression) {
    const object = node.childForFieldName(cfg.memberObjectField ?? "object");
    const property = node.childForFieldName(cfg.memberPropertyField ?? "property");
    if (object?.text === self && property) selfTokens.add(property.text);
  }
  for (const child of node.namedChildren) if (child) collect(child, cfg, tokens, selfTokens, self, skip);
}

function unitOf(
  node: Node,
  name: string,
  owner: string | undefined,
  cfg: CohesionConfig,
  self: string = cfg.selfObject,
  skip?: Node,
): Unit {
  const tokens = new Set<string>();
  const selfTokens = new Set<string>();
  collect(node, cfg, tokens, selfTokens, self, skip);
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

/** The type a receiver is declared on: `*Box` and `Box[T]` both give `Box`. */
function receiverType(type: Node | null | undefined): string | undefined {
  return type?.text.replace(/^\*+/, "").replace(/\[.*$/, "").trim() || undefined;
}

function membersOf(d: Declarations, owner: string): ClassMembers {
  const known = d.classMembers.get(owner);
  if (known) return known;
  const members: ClassMembers = { methods: new Map(), fields: new Set() };
  d.classMembers.set(owner, members);
  return members;
}

/** A method declared outside its type: its owner is the receiver's type, its self object the receiver's name. */
function addReceiverMethod(node: Node, d: Declarations, cfg: CohesionConfig, field: string): void {
  const receiverList = node.childForFieldName(field);
  const receiver = receiverList?.namedChildren[0];
  const owner = receiverType(receiver?.childForFieldName("type"));
  const name = node.childForFieldName("name")?.text;
  if (!owner || !name) return;
  membersOf(d, owner).methods.set(name, d.units.length);
  // the receiver names the type on every method: it says nothing about what the method shares with the others
  const self = receiver?.childForFieldName("name")?.text ?? "";
  d.units.push(unitOf(node, `${owner}.${name}`, owner, cfg, self, receiverList ?? undefined));
}

/** The types of a declaration: each is a declared name, a struct also gives the fields of its type. */
function addTypes(
  node: Node,
  d: Declarations,
  cfg: CohesionConfig,
  r: NonNullable<CohesionConfig["receivers"]>,
) {
  for (const spec of node.namedChildren) {
    if (spec?.type !== r.typeSpec) continue;
    const name = spec.childForFieldName("name")?.text;
    if (!name) continue;
    d.declared.add(name);
    const type = spec.childForFieldName("type");
    if (type?.type !== r.structNode) continue;
    const members = membersOf(d, name);
    for (const list of type.namedChildren)
      for (const field of list?.namedChildren ?? [])
        if (field?.type === r.fieldNode)
          for (const id of field.childrenForFieldName("name")) if (id) members.fields.add(id.text);
  }
}

/** The names declared by the specs of a `const` or `var` declaration. */
function addSpecs(node: Node, d: Declarations, spec: string): void {
  const specs = node.type === spec ? [node] : node.namedChildren.filter((c) => c?.type === spec);
  for (const s of specs)
    for (const id of s?.childrenForFieldName("name") ?? []) if (id) d.declared.add(id.text);
}

function addDeclaration(top: Node, d: Declarations, cfg: CohesionConfig): void {
  const assigned = assignedName(top, cfg);
  if (assigned) {
    d.declared.add(assigned);
    return;
  }
  const node = unwrap(top, cfg);
  const r = cfg.receivers;
  if (r && node.type === r.methodNode) return addReceiverMethod(node, d, cfg, r.receiverField);
  if (r && node.type === r.typeDeclaration) return addTypes(node, d, cfg, r);
  const specKind = cfg.specDeclarations?.[node.type];
  if (specKind) return addSpecs(node, d, specKind);
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
