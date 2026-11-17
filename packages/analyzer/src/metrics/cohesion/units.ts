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
  if (cfg.selfTokenTypes?.includes(node.type)) selfTokens.add(node.text.replace(/^@+/, ""));
  if (cfg.memberExpression.split("|").includes(node.type)) {
    // without field names (Kotlin) the object is the first child and the property the last
    const positional = cfg.memberObjectField === "";
    const object = positional
      ? node.namedChildren[0]
      : node.childForFieldName(cfg.memberObjectField ?? "object");
    const property = positional
      ? node.namedChildren[node.namedChildren.length - 1]
      : node.childForFieldName(cfg.memberPropertyField ?? "property");
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
  const assignment =
    statement.type === a.node ? statement : statement.namedChildren.find((c) => c?.type === a.node);
  const name = assignment?.childForFieldName(a.nameField);
  return name && ["identifier", "constant"].includes(name.type) ? name.text : undefined;
}

/** The field names a member declares through declarators (`int a, b;`), when the language writes them so. */
function declaredFields(member: Node, cfg: CohesionConfig): string[] {
  const d = cfg.fieldDeclarators;
  if (!d) return [];
  const holder = d.through ? member.namedChildren.find((c) => c?.type === d.through) : member;
  return (holder?.namedChildren ?? [])
    .filter((c) => c?.type === d.declaratorType)
    .map((c) => (d.nameField === "" ? c?.text : c?.childForFieldName(d.nameField)?.text)?.replace(/^\$/, ""))
    .filter((n): n is string => n !== undefined);
}

/** The fields a primary constructor declares through its parameters (Kotlin `class A(val x: Int)`). */
function constructorFields(cls: Node, cfg: CohesionConfig): string[] {
  const c = cfg.constructorParams;
  if (!c) return [];
  const ctor = cls.namedChildren.find((n) => n?.type === c.constructor);
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.type === c.parameter) {
      const id = n.namedChildren.find((x) => x?.type === "identifier")?.text;
      if (id) out.push(id);
    } else for (const child of n.namedChildren) if (child) walk(child);
  };
  if (ctor) walk(ctor);
  return out;
}

/** The fields a class-body call declares through symbols (`attr_accessor :a, :b`). */
function attributeFields(member: Node | null, cfg: CohesionConfig): string[] {
  if (!member || !cfg.attributeCalls || member.type !== "call") return [];
  if (!cfg.attributeCalls.includes(member.childForFieldName("method")?.text ?? "")) return [];
  return (member.childForFieldName("arguments")?.namedChildren ?? [])
    .filter((a) => a?.type === "simple_symbol")
    .map((a) => (a as Node).text.replace(/^:/, ""));
}

/** A class: its methods become units, its fields are kept to link the methods that share them. */
function addClass(node: Node, name: string, d: Declarations, cfg: CohesionConfig): void {
  d.declared.add(name);
  const members = membersOf(d, name);
  for (const field of constructorFields(node, cfg)) members.fields.add(field);
  const body =
    node.childForFieldName("body") ?? node.namedChildren.find((c) => c?.type === cfg.classBodyType);
  for (const raw of body?.namedChildren ?? []) {
    for (const field of attributeFields(raw, cfg)) members.fields.add(field);
    const assigned = raw ? assignedName(raw, cfg) : undefined;
    if (assigned) {
      members.fields.add(assigned);
      continue;
    }
    const member = raw ? unwrap(raw, cfg) : undefined;
    const declared = member && cfg.fields.includes(member.type) ? declaredFields(member, cfg) : [];
    if (declared.length > 0) {
      for (const field of declared) members.fields.add(field);
      continue;
    }
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
  for (const s of specs) {
    // the name is in the field `name`; a Kotlin property keeps it in its variable declaration
    const named = s?.childrenForFieldName("name") ?? [];
    const names =
      named.length > 0
        ? named
        : [s?.namedChildren.find((c) => c?.type === "variable_declaration")?.namedChildren[0]];
    for (const id of names) if (id) d.declared.add(id.text);
  }
}

/** A struct: a declared name, and the fields of its type for the methods that share them. */
function addStruct(node: Node, d: Declarations): void {
  const name = node.childForFieldName("name")?.text;
  if (!name) return;
  d.declared.add(name);
  const members = membersOf(d, name);
  for (const field of node.childForFieldName("body")?.namedChildren ?? []) {
    const id = field?.childForFieldName("name")?.text;
    if (id) members.fields.add(id);
  }
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
  if (cfg.structNodes?.includes(node.type)) return addStruct(node, d);
  const name = node.childForFieldName("name")?.text;
  const className = cfg.classNameField ? receiverType(node.childForFieldName(cfg.classNameField)) : name;
  if (cfg.functionDeclarations.includes(node.type) && name) d.units.push(unitOf(node, name, undefined, cfg));
  else if (cfg.variableDeclarations.includes(node.type)) addVariables(node, d, cfg);
  else if (cfg.classDeclarations.includes(node.type) && className) addClass(node, className, d, cfg);
  else if (cfg.otherDeclarations.includes(node.type) && name) d.declared.add(name);
}

/** Reads a list of top-level nodes; the members of a container (a namespace) are read as top level too. */
function readTop(nodes: ReadonlyArray<Node | null>, d: Declarations, cfg: CohesionConfig): void {
  for (const top of nodes) {
    if (!top || top.type === "comment") continue;
    if (cfg.containers?.includes(top.type)) {
      readTop(
        (top.childForFieldName("body") ?? top).namedChildren.filter(
          (c) => c?.id !== top.childForFieldName("name")?.id,
        ),
        d,
        cfg,
      );
      continue;
    }
    d.statements++;
    if (!isBarrelStatement(top, cfg)) d.nonBarrel++;
    addDeclaration(top, d, cfg);
  }
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
  readTop(root.namedChildren, d, cfg);
  return d;
}
