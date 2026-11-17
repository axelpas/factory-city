import { posix } from "node:path";
import { dirOf } from "./paths.js";
import type { ResolveContext } from "./types.js";

/** Index of the Python files of a project by every module name they could answer to, built once per file set. */
const indexes = new WeakMap<ReadonlySet<string>, Map<string, string[]>>();

/** `a/b/c.py` answers to `c`, `b.c` and `a.b.c`; `a/b/__init__.py` answers to `b` and `a.b`. */
function indexOf(files: ReadonlySet<string>): Map<string, string[]> {
  const known = indexes.get(files);
  if (known) return known;
  const index = new Map<string, string[]>();
  for (const file of files) {
    if (!file.endsWith(".py") && !file.endsWith(".pyi")) continue;
    const stem = file.replace(/\.pyi?$/, "");
    const module = stem.endsWith("/__init__") ? stem.slice(0, -"/__init__".length) : stem;
    if (module === "" || module === "__init__") continue;
    const parts = module.split("/");
    for (let from = 0; from < parts.length; from++) {
      const key = parts.slice(from).join(".");
      const list = index.get(key);
      if (list) list.push(file);
      else index.set(key, [file]);
    }
  }
  indexes.set(files, index);
  return index;
}

/** The file closest to the importer: the one that shares the longest folder prefix with it. */
function nearest(candidates: readonly string[], from: string): string | undefined {
  const here = dirOf(from).split("/");
  let best: string | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    const there = dirOf(candidate).split("/");
    let score = 0;
    while (score < here.length && score < there.length && here[score] === there[score]) score++;
    if (score > bestScore || (score === bestScore && best !== undefined && candidate < best)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function inFolder(dir: string, rest: string, files: ReadonlySet<string>): string | undefined {
  const base = rest === "" ? dir : posix.join(dir, rest.replace(/\./g, "/"));
  for (const candidate of rest === ""
    ? [`${base}/__init__.py`]
    : [`${base}.py`, `${base}.pyi`, `${base}/__init__.py`])
    if (files.has(candidate.replace(/^\//, ""))) return candidate.replace(/^\//, "");
  return undefined;
}

/**
 * A Python module name to a file of the project: `.a.b` is relative to the importing file's folder (one more dot
 * goes one folder up), `a.b` is looked up by name among the project's files, the closest one first. A name that
 * no file answers to (the standard library, installed packages) has no file.
 */
export function resolvePython(spec: string, from: string, files: ReadonlySet<string>): string | undefined {
  const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
  const rest = spec.slice(dots);
  if (dots > 0) {
    let dir = dirOf(from);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    return inFolder(dir, rest, files);
  }
  const hits = indexOf(files).get(rest);
  return hits ? nearest(hits, from) : undefined;
}

/** The non-test Go files of each folder, built once per file set. */
const goFolders = new WeakMap<ReadonlySet<string>, Map<string, string[]>>();

function goFoldersOf(files: ReadonlySet<string>): Map<string, string[]> {
  const known = goFolders.get(files);
  if (known) return known;
  const folders = new Map<string, string[]>();
  for (const file of files) {
    if (!file.endsWith(".go") || file.endsWith("_test.go")) continue;
    const dir = dirOf(file);
    const list = folders.get(dir);
    if (list) list.push(file);
    else folders.set(dir, [file]);
  }
  goFolders.set(files, folders);
  return folders;
}

/**
 * The files of the package a Go import path names. A package is a folder: the import links to the files of that
 * folder. The folder comes from the module path of the nearest `go.mod` that is a prefix of the import path; with
 * no `go.mod` in the analyzed folder, from the folder whose path ends like the import path (two segments at least).
 * A path of no module of the project (the standard library, dependencies) has no file.
 */
export function resolveGo(spec: string, ctx: ResolveContext): string[] {
  const folders = goFoldersOf(ctx.files);
  if (ctx.goModules.size > 0) {
    let best: { dir: string; path: string } | undefined;
    for (const [dir, path] of ctx.goModules)
      if ((spec === path || spec.startsWith(`${path}/`)) && (!best || path.length > best.path.length))
        best = { dir, path };
    if (!best) return [];
    const rest = spec.slice(best.path.length + 1);
    return folders.get(rest ? posix.join(best.dir, rest) : best.dir) ?? [];
  }
  const segments = spec.split("/");
  // the longest tail of the import path that is also the end of a folder of the project
  for (let keep = segments.length; keep >= 2; keep--) {
    const tail = segments.slice(-keep).join("/");
    for (const [dir, list] of folders) if (dir === tail || dir.endsWith(`/${tail}`)) return list;
  }
  return [];
}

interface JavaIndex {
  /** Classes by every dotted tail of their path: `com/a/B.java` answers to `B`, `a.B` and `com.a.B`. */
  classes: Map<string, string[]>;
  /** Files of each folder by every dotted tail of its path, for `import a.b.*`. */
  packages: Map<string, string[]>;
}

const javaIndexes = new WeakMap<ReadonlySet<string>, Map<string, JavaIndex>>();

function javaIndexOf(files: ReadonlySet<string>, ext = ".java"): JavaIndex {
  const byExt = javaIndexes.get(files) ?? new Map<string, JavaIndex>();
  javaIndexes.set(files, byExt);
  const known = byExt.get(ext);
  if (known) return known;
  const classes = new Map<string, string[]>();
  const packages = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, path: string, file: string) => {
    const parts = path.split("/");
    for (let from = 0; from < parts.length; from++) {
      const key = parts.slice(from).join(".");
      const list = map.get(key);
      if (list) list.push(file);
      else map.set(key, [file]);
    }
  };
  for (const file of files) {
    if (!file.endsWith(ext)) continue;
    add(classes, file.slice(0, -ext.length), file);
    const dir = dirOf(file);
    if (dir) add(packages, dir, file);
  }
  const index = { classes, packages };
  byExt.set(ext, index);
  return index;
}

/**
 * The files a Java import stands for. A class is a file named after it, in the folders of its package: `a.b.C`
 * answers to the file whose path ends with `a/b/C.java`, the closest to the importer first. A static import
 * (`a.b.C.member`) is read as the class it names, so the trailing names are dropped until a file answers. `a.b.*`
 * is every file of the package folder. A name that no file answers to (the JDK, libraries) has no file. Classes
 * of the same package need no import: they are not seen.
 */
export function resolveJava(spec: string, from: string, files: ReadonlySet<string>): string[] {
  const index = javaIndexOf(files);
  const wildcard = spec.endsWith(".*");
  const name = wildcard ? spec.slice(0, -2) : spec;
  const segments = name.split(".");
  // a class first, then the classes a static member import reaches through
  for (let keep = segments.length; keep >= 2; keep--) {
    const hits = index.classes.get(segments.slice(0, keep).join("."));
    const file = hits ? nearest(hits, from) : undefined;
    if (file) return [file];
  }
  return wildcard ? (index.packages.get(name) ?? []) : [];
}

/**
 * The files a C# `using` stands for: the files that declare the namespace it names. A `using static` or an alias
 * names a class, not a namespace: it has no file. A namespace no file declares (the framework, packages) has none.
 */
export function resolveCsharp(spec: string, ctx: ResolveContext): string[] {
  // only the namespace itself: a name that no file declares is a package, and must not fall back on its prefix
  return ctx.namespaces.get(spec) ?? [];
}

/**
 * The files a Kotlin import stands for. A class is looked up by its name in the folders of its package, as in Java;
 * a top-level function or property has no file named after it, so the files that declare the package it sits in
 * are linked instead. `a.b.*` is the package.
 */
export function resolveKotlin(spec: string, from: string, ctx: ResolveContext): string[] {
  const wildcard = spec.endsWith(".*");
  const name = wildcard ? spec.slice(0, -2) : spec;
  const index = javaIndexOf(ctx.files, ".kt");
  const segments = name.split(".");
  for (let keep = segments.length; keep >= 2; keep--) {
    const hits = index.classes.get(segments.slice(0, keep).join("."));
    const file = hits ? nearest(hits, from) : undefined;
    if (file) return [file];
  }
  // a top-level function or property is named in lower case: its package is the name without it
  const last = segments[segments.length - 1] ?? "";
  const pkg = wildcard || !/^[a-z]/.test(last) ? name : segments.slice(0, -1).join(".");
  return ctx.namespaces.get(pkg) ?? [];
}

/** `a::{b, c::d, self}` and `a::*` as the list of paths they stand for. */
function expandUse(spec: string): string[] {
  const open = spec.indexOf("{");
  if (open < 0) return [spec.replace(/::\*$/, "")];
  const prefix = spec.slice(0, open).replace(/::$/, "");
  const inner = spec.slice(open + 1, spec.lastIndexOf("}"));
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if ((c === "," && depth === 0) || i === inner.length) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  return parts
    .filter((p) => p !== "")
    .flatMap((p) => (p === "self" ? [prefix] : expandUse(`${prefix}::${p}`)))
    .filter((p) => p !== "");
}

function rustModuleFile(base: string, segments: string[], files: ReadonlySet<string>): string | undefined {
  for (let keep = segments.length; keep >= 1; keep--) {
    const path = posix.join(base, ...segments.slice(0, keep));
    for (const candidate of [`${path}.rs`, `${path}/mod.rs`]) if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The files a Rust `use` or `mod x;` stands for. The module tree is the folder tree: a module `x` of the file `a/b.rs`
 * is `a/b/x.rs` or `a/b/x/mod.rs` (next to it for `lib.rs`, `main.rs` and `mod.rs`). `crate::` starts at the nearest
 * `src` folder, `super::` at the parent module, `self::` here; another crate is looked up among the crates of the
 * project by the name its `Cargo.toml` gives. Trailing names (a type, a function) are dropped until a module file
 * answers. `std`, `core` and dependencies have no file.
 */
export function resolveRust(spec: string, from: string, ctx: ResolveContext): string[] {
  const dir = dirOf(from);
  const stem = posix.basename(from).replace(/\.rs$/, "");
  const here = ["lib", "main", "mod"].includes(stem) ? dir : posix.join(dir, stem);
  if (spec.startsWith("mod:")) {
    const name = spec.slice(4);
    return [posix.join(here, `${name}.rs`), posix.join(here, name, "mod.rs")]
      .filter((f) => ctx.files.has(f))
      .slice(0, 1);
  }
  const out = new Set<string>();
  for (const path of expandUse(spec)) {
    const [head, ...rest] = path.split("::");
    let found: string | undefined;
    if (head === "crate" || head === "self" || head === "super") {
      const src = head === "crate" ? srcOf(dir) : head === "self" ? here : dir;
      if (src === undefined) continue;
      const segments = head === "super" ? rest : rest;
      found =
        rustModuleFile(src, segments, ctx.files) ??
        (head === "crate" && segments.length > 0
          ? ["lib.rs", "main.rs"].map((r) => posix.join(src, r)).find((f) => ctx.files.has(f))
          : undefined) ??
        (head === "super" ? parentModuleFile(dir, ctx.files) : undefined);
    } else if (head && ctx.rustCrates.has(head)) {
      const src = posix.join(ctx.rustCrates.get(head) as string, "src");
      found = rest.length > 0 ? rustModuleFile(src, rest, ctx.files) : undefined;
      found ??= ["lib.rs", "main.rs"].map((r) => posix.join(src, r)).find((f) => ctx.files.has(f));
    }
    if (found && found !== from) out.add(found);
  }
  return [...out];
}

/** The folder of the nearest `src` above a folder, which holds the root module of the crate. */
function srcOf(dir: string): string | undefined {
  let d = dir;
  for (;;) {
    if (posix.basename(d) === "src") return d;
    if (d === "") return undefined;
    d = dirOf(d);
  }
}

/** The file of the module that holds the folder: `mod.rs`, `<folder>.rs`, or the crate root. */
function parentModuleFile(dir: string, files: ReadonlySet<string>): string | undefined {
  return [`${dir}/mod.rs`, `${dir}.rs`, `${dir}/lib.rs`, `${dir}/main.rs`].find((f) => files.has(f));
}
