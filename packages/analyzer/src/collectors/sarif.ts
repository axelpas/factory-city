import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExternalFindings } from "@factory-city/schema";

export type SarifLevel = "error" | "warning" | "note";

/** What is kept of one result: where, how serious, which rule. Never the message nor a snippet. */
export interface SarifFinding {
  /** Path as the tool wrote it, before it is matched to an analyzed file; undefined without a location. */
  uri: string | undefined;
  level: SarifLevel;
  ruleId: string | undefined;
  line: number | undefined;
}

export interface SarifRun {
  tool: string;
  version?: string;
  findings: SarifFinding[];
  /** Files the tool says it looked at (`artifacts`), when it lists them. */
  scanned: string[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function levelOf(value: unknown): SarifLevel | undefined {
  if (value === "error") return "error";
  if (value === "warning") return "warning";
  if (value === "note" || value === "none") return "note";
  return undefined;
}

/** Default level of each rule of a run, by rule id (`reportingDescriptor.defaultConfiguration.level`). */
function ruleLevels(driver: Json): Map<string, SarifLevel> {
  const levels = new Map<string, SarifLevel>();
  for (const rule of list(driver.rules)) {
    const r = obj(rule);
    const id = text(r?.id);
    const level = levelOf(obj(r?.defaultConfiguration)?.level);
    if (id && level) levels.set(id, level);
  }
  return levels;
}

function uriOf(location: unknown): string | undefined {
  return text(obj(obj(obj(location)?.physicalLocation)?.artifactLocation)?.uri);
}

function lineOf(location: unknown): number | undefined {
  const line = obj(obj(obj(location)?.physicalLocation)?.region)?.startLine;
  return typeof line === "number" ? line : undefined;
}

function readRun(run: Json): SarifRun {
  const driver = obj(obj(run.tool)?.driver) ?? {};
  const levels = ruleLevels(driver);
  const findings: SarifFinding[] = [];
  for (const raw of list(run.results)) {
    const result = obj(raw);
    if (!result) continue;
    const ruleId = text(result.ruleId) ?? text(obj(result.rule)?.id);
    const first = list(result.locations)[0];
    findings.push({
      uri: uriOf(first),
      level: levelOf(result.level) ?? (ruleId ? levels.get(ruleId) : undefined) ?? "warning",
      ruleId,
      line: lineOf(first),
    });
  }
  const scanned = list(run.artifacts)
    .map((a) => text(obj(obj(a)?.location)?.uri))
    .filter((u): u is string => u !== undefined);
  return {
    tool: text(driver.name) ?? "unknown tool",
    ...(text(driver.semanticVersion ?? driver.version)
      ? { version: text(driver.semanticVersion ?? driver.version) as string }
      : {}),
    findings,
    scanned,
  };
}

/** Reads a SARIF 2.1.0 file. Throws an actionable message when it is not one. */
export async function readSarif(file: string): Promise<SarifRun[]> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new Error(
      `SARIF file ${file} could not be read: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }
  const root = obj(json);
  const runs = list(root?.runs);
  if (!root || !String(root.version ?? "").startsWith("2.") || runs.length === 0)
    throw new Error(`${file} is not a SARIF 2.1.0 file (no "version": "2.1.0" and "runs").`);
  return runs.map((r) => readRun(obj(r) ?? {}));
}

/** A path from a SARIF uri, relative to the analyzed folder; undefined when it points outside of it. */
export function pathInFolder(uri: string, folder: string): string | undefined {
  let path = uri;
  if (uri.startsWith("file:")) {
    try {
      path = fileURLToPath(uri);
    } catch {
      return undefined;
    }
  }
  path = decodeURIComponent(path).replace(/\\/g, "/");
  const root = resolve(folder);
  const rel = isAbsolute(path) ? relative(root, path).replace(/\\/g, "/") : path.replace(/^\.\//, "");
  return rel.startsWith("..") || isAbsolute(rel) ? undefined : rel;
}

/**
 * The analyzed path a uri stands for. Paths of the analysis are relative to the folder given, even with `--path`;
 * a scanner that ran inside that subfolder wrote paths without it, so it is tried as a prefix too.
 */
function matchPath(
  uri: string,
  folder: string,
  analyzed: ReadonlyMap<string, unknown>,
  subPath?: string,
): string | undefined {
  const rel = pathInFolder(uri, folder);
  if (rel === undefined || analyzed.has(rel) || !subPath) return rel;
  const inSub = `${subPath.replace(/\\/g, "/").replace(/\/$/, "")}/${rel}`;
  return analyzed.has(inSub) ? inSub : rel;
}

export interface SarifAttach {
  /** Values to add to each analyzed file that the tool covers (zero for a covered file without findings). */
  perFile: Map<string, { findings: number; errors: number }>;
  external: ExternalFindings[];
}

const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : base.toLowerCase();
};

/**
 * Attaches the findings of the runs to analyzed files. A file counts as covered by a tool when the file of the
 * tool mentions a file with the same extension (a finding or an `artifacts` entry): a covered file with no
 * finding is 0, any other is unavailable, because a scanner that does not read a language says nothing about it.
 */
export function attachSarif(
  runs: readonly SarifRun[],
  folder: string,
  analyzed: ReadonlyMap<string, { isTest: boolean }>,
  subPath?: string,
): SarifAttach {
  const perFile = new Map<string, { findings: number; errors: number }>();
  const external: ExternalFindings[] = [];
  const covered = new Set<string>();
  const bump = (path: string, error: boolean) => {
    const v = perFile.get(path) ?? { findings: 0, errors: 0 };
    v.findings++;
    if (error) v.errors++;
    perFile.set(path, v);
  };
  for (const run of runs) {
    const apart = { noLocation: 0, outside: 0, notAnalyzed: 0, tests: 0 };
    let counted = 0;
    for (const uri of run.scanned) {
      const p = matchPath(uri, folder, analyzed, subPath);
      if (p) covered.add(extOf(p));
    }
    for (const f of run.findings) {
      if (!f.uri) {
        apart.noLocation++;
        continue;
      }
      const p = matchPath(f.uri, folder, analyzed, subPath);
      if (!p) {
        apart.outside++;
        continue;
      }
      covered.add(extOf(p));
      const file = analyzed.get(p);
      if (!file) apart.notAnalyzed++;
      else if (file.isTest) apart.tests++;
      else {
        bump(p, f.level === "error");
        counted++;
      }
    }
    external.push({
      kind: "sarif",
      tool: run.tool,
      ...(run.version ? { version: run.version } : {}),
      results: run.findings.length,
      counted,
      apart,
    });
  }
  if (perFile.size === 0 && covered.size === 0) return { perFile, external };
  for (const [path, file] of analyzed)
    if (!file.isTest && covered.has(extOf(path)) && !perFile.has(path))
      perFile.set(path, { findings: 0, errors: 0 });
  return { perFile, external };
}
