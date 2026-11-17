/** A package version of a lockfile. */
export interface LockedPackage {
  name: string;
  version: string;
}

export type LockfileKind = "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock";

/** The lockfiles that are read, in the order of preference when a folder has several. */
export const LOCKFILES: readonly LockfileKind[] = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

const key = (p: LockedPackage) => `${p.name}@${p.version}`;

/** One entry per name and version, sorted: the same lockfile always gives the same list. */
function unique(packages: readonly LockedPackage[]): LockedPackage[] {
  const seen = new Map(packages.map((p) => [key(p), p]));
  return [...seen.values()].sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

/** A real version: links, files and git sources have none that a database can match. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/** package-lock.json: version 2 and 3 list `packages` by path; version 1 nests `dependencies`. */
export function parsePackageLock(content: string): LockedPackage[] {
  const json = JSON.parse(content) as {
    packages?: Record<string, { version?: string; name?: string; link?: boolean }>;
    dependencies?: Record<string, { version?: string; dependencies?: unknown }>;
  };
  const out: LockedPackage[] = [];
  if (json.packages) {
    for (const [path, entry] of Object.entries(json.packages)) {
      if (path === "" || entry.link || !entry.version) continue;
      const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      if (path.includes("node_modules/")) out.push({ name, version: entry.version });
    }
  } else {
    const walk = (deps: Record<string, { version?: string; dependencies?: unknown }> | undefined) => {
      for (const [name, entry] of Object.entries(deps ?? {})) {
        if (entry.version) out.push({ name, version: entry.version });
        walk(entry.dependencies as typeof deps);
      }
    };
    walk(json.dependencies);
  }
  return unique(out.filter((p) => VERSION.test(p.version)));
}

/** `name@version` where the name may start with `@scope/`. */
function splitAt(spec: string): LockedPackage | undefined {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return undefined;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/**
 * pnpm-lock.yaml: the keys of the `packages:` section, `/name@1.2.3:` (version 6), `name@1.2.3:` (version 9)
 * or `/name/1.2.3:` (before 6), with the peer-dependency suffix `(...)` or `_...` dropped.
 */
export function parsePnpmLock(content: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = line.trim() === "packages:";
      continue;
    }
    const match = inPackages ? /^ {2}(['"]?)([^\s'"]+)\1:\s*$/.exec(line) : null;
    if (!match) continue;
    let spec = (match[2] as string).replace(/^\//, "").replace(/\(.*$/, "");
    const old = /^(.+)\/(\d[^/]*)$/.exec(spec);
    if (old && !spec.includes("@", 1)) spec = `${old[1]}@${old[2]}`;
    const parsed = splitAt(spec);
    if (!parsed) continue;
    parsed.version = parsed.version.replace(/_.*$/, "");
    out.push(parsed);
  }
  return unique(out.filter((p) => VERSION.test(p.version)));
}

/**
 * yarn.lock, classic (`name@range:` then `version "1.2.3"`) and berry (`"name@npm:range":` then
 * `version: 1.2.3`). The name is read from the first spec of the header.
 */
export function parseYarnLock(content: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let name: string | undefined;
  let version: string | undefined;
  const close = () => {
    if (name && version) out.push({ name, version });
    name = undefined;
    version = undefined;
  };
  for (const line of content.split(/\r?\n/)) {
    if (/^\S/.test(line) && !line.startsWith("#")) {
      close();
      const first = line.replace(/:\s*$/, "").split(",")[0]?.trim().replace(/^"|"$/g, "") ?? "";
      name = first.startsWith("__metadata") ? undefined : splitAt(first)?.name;
      // a patched or workspace entry is named `resolve@patch:resolve`: it is not a registry package
      if (name?.includes("@patch:") || name?.includes("@workspace:")) name = undefined;
      continue;
    }
    version = /^ {2}version:?\s+"?([^"\s]+)"?\s*$/.exec(line)?.[1] ?? version;
    const resolution = /^ {2}resolution:\s+"?([^"]+?)"?\s*$/.exec(line)?.[1];
    // berry says where the package comes from: only the registry (`@npm:`) is asked about
    if (resolution !== undefined && !resolution.includes("@npm:")) name = undefined;
  }
  close();
  return unique(out.filter((p) => VERSION.test(p.version) && !p.version.includes("use.local")));
}

export function parseLockfile(kind: LockfileKind, content: string): LockedPackage[] {
  if (kind === "package-lock.json") return parsePackageLock(content);
  if (kind === "pnpm-lock.yaml") return parsePnpmLock(content);
  return parseYarnLock(content);
}
