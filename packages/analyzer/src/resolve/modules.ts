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

const javaIndexes = new WeakMap<ReadonlySet<string>, JavaIndex>();

function javaIndexOf(files: ReadonlySet<string>): JavaIndex {
  const known = javaIndexes.get(files);
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
    if (!file.endsWith(".java")) continue;
    add(classes, file.slice(0, -".java".length), file);
    const dir = dirOf(file);
    if (dir) add(packages, dir, file);
  }
  javaIndexes.set(files, { classes, packages });
  return { classes, packages };
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
 * The files a C# `using` stands for: the files that declare the namespace it names. `using static A.B.C` names a
 * class, so the last names are dropped until a namespace answers. A namespace no file declares (the framework,
 * packages) has no file.
 */
export function resolveCsharp(spec: string, ctx: ResolveContext): string[] {
  const segments = spec.split(".");
  for (let keep = segments.length; keep >= 1; keep--) {
    const files = ctx.namespaces.get(segments.slice(0, keep).join("."));
    if (files) return files;
  }
  return [];
}
