import type {
  ActionType,
  FrameHealth,
  Health,
  HiddenLink,
  Hotspot,
  HotspotAction,
  RiskDimension,
  RiskShare,
} from "@factory-city/schema";
import { rate } from "./dimensions.js";

/** What the health computation needs to know about one file. */
export interface HealthFile {
  path: string;
  values: Record<string, number>;
  isTest: boolean;
}

/** Things the report can name: the declarations of each cohesion group, the links between files. */
export interface HealthExtras {
  /** File path to its cohesion groups, each a list of declaration names. */
  groups?: ReadonlyMap<string, string[][]>;
  /** Internal import links, as [from, to]. */
  imports?: ReadonlyArray<readonly [string, string]>;
  /** Pairs of files that usually change together. */
  coChange?: ReadonlyArray<readonly [string, string]>;
  /** File path to the file it shares the most copied lines with. */
  duplicates?: ReadonlyMap<string, string>;
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Risk profile and score of a set of files, weighted by real lines of code. */
export function computeHealth(files: readonly HealthFile[], dimensions: readonly RiskDimension[]): Health {
  const total = files.reduce((sum, f) => sum + (f.values.rloc ?? 0), 0);
  const profile: Record<string, RiskShare> = {};
  const scored: string[] = [];
  for (const d of dimensions) {
    const weight = { low: 0, moderate: 0, high: 0, veryHigh: 0 };
    let rated = 0;
    for (const f of files) {
      const level = rate(f.values, d);
      if (!level) continue;
      const w = f.values.rloc ?? 0;
      weight[level] += w;
      rated += w;
    }
    if (rated === 0) continue;
    profile[d.id] = {
      low: round(weight.low / rated),
      moderate: round(weight.moderate / rated),
      high: round(weight.high / rated),
      veryHigh: round(weight.veryHigh / rated),
      rated: round(total === 0 ? 0 : rated / total),
    };
    if (d.kind === "static") scored.push(d.id);
  }
  const statics = dimensions.filter((d) => d.kind === "static");
  let healthy = 0;
  for (const f of files) {
    const levels = statics.map((d) => rate(f.values, d)).filter((l) => l !== undefined);
    if (levels.every((l) => l === "low")) healthy += f.values.rloc ?? 0;
  }
  return { score: total === 0 ? 100 : round((healthy / total) * 100, 1), profile, scored };
}

function percentile(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

const SHORTCUT_NAMES: Record<string, string> = {
  any: "any",
  ts_ignore: "@ts-ignore",
  ts_expect_error: "@ts-expect-error",
  ts_nocheck: "@ts-nocheck",
  lint_disable: "lint-disable comments",
  skipped_test: "skipped tests",
  focused_test: "focused tests",
  empty_catch: "empty catch blocks",
};

function actionsFor(file: HealthFile, exceeded: Hotspot["exceeded"], extras: HealthExtras): HotspotAction[] {
  const out: HotspotAction[] = [];
  const add = (type: ActionType, text: string) => {
    if (!out.some((a) => a.type === type)) out.push({ type, text });
  };
  const is = (dimension: string) => exceeded.some((e) => e.dimension === dimension);
  const v = file.values;
  if (is("cohesion")) {
    const groups = extras.groups?.get(file.path) ?? [];
    const named = groups.map((g) => g.slice(0, 3).join(", ") + (g.length > 3 ? ", ..." : ""));
    const detail =
      named.length > 1
        ? ` along its ${named.length} groups: ${named.map((n) => `(${n})`).join(" ")}`
        : " along its cohesion groups";
    add("split-file", `Split the file${detail}.`);
  }
  if (is("complexity"))
    add(
      "extract-functions",
      `Extract functions from the most complex one (complexity ${v.max_function_complexity}).`,
    );
  if (is("nesting"))
    add(
      "flatten-nesting",
      `Flatten nesting (deepest level ${v.max_nesting_level}) with early returns or extracted helpers.`,
    );
  if (is("duplication")) {
    const partner = extras.duplicates?.get(file.path);
    add("deduplicate", partner ? `Deduplicate with \`${partner}\`.` : "Deduplicate the copied code.");
  }
  if (is("coupling")) add("reduce-imports", `Reduce imports (${v.imports_out} internal modules).`);
  if (is("shortcuts")) {
    const kinds = Object.entries(SHORTCUT_NAMES)
      .filter(([kind]) => (v[`escape_${kind}`] ?? 0) > 0)
      .map(([kind, name]) => `${v[`escape_${kind}`]} ${name}`);
    add("remove-shortcuts", `Remove shortcuts${kinds.length ? `: ${kinds.join(", ")}` : ""}.`);
  }
  if (is("fixes"))
    add("add-tests", `Add tests before the next change (${v.fix_commits_recent} recent fixes).`);
  if ((v.issues_recent ?? 0) >= 3)
    add("separate-concerns", `Separate what ${v.issues_recent} recent issues keep colliding on.`);
  if (is("size")) add("split-file", `Split the file (${v.rloc} real lines).`);
  if (out.length === 0)
    add("extract-functions", "Simplify the most complex functions before the next change.");
  return out;
}

const KEY_METRICS = [
  "rloc",
  "mcc",
  "max_function_complexity",
  "max_nesting_level",
  "imports_out",
  "cohesion_groups",
  "escape_hatches",
  "recent_commits",
  "fix_commits_recent",
  "rework_ratio",
  "issues_recent",
];

/**
 * The top hotspots: complex code that changes often, or complex and large code when there is no history.
 * Tests are left out. Ties are broken by path, so the ranking is deterministic.
 */
export function findHotspots(
  files: readonly HealthFile[],
  dimensions: readonly RiskDimension[],
  extras: HealthExtras = {},
  top = 5,
): Hotspot[] {
  const code = files.filter((f) => !f.isTest && f.values.mcc !== undefined);
  const withChange = code.some((f) => (f.values.recent_commits ?? 0) > 0);
  const second = withChange ? "recent_commits" : "rloc";
  const sorted = (metric: string) => code.map((f) => f.values[metric] ?? 0).sort((a, b) => a - b);
  const complexity = sorted("mcc");
  const other = sorted(second);
  const ranked = code
    .map((f) => ({
      f,
      heat: percentile(complexity, f.values.mcc ?? 0) * percentile(other, f.values[second] ?? 0),
    }))
    .filter((x) => !withChange || (x.f.values.recent_commits ?? 0) > 0)
    .sort((a, b) => b.heat - a.heat || (a.f.path < b.f.path ? -1 : 1))
    .slice(0, top);
  return ranked.map(({ f }, i) => {
    const exceeded: Hotspot["exceeded"] = [];
    for (const d of dimensions) {
      const level = rate(f.values, d);
      if (level === "high" || level === "veryHigh") {
        exceeded.push({
          dimension: d.id,
          level,
          value: f.values[d.metric] as number,
          bound: level === "veryHigh" ? d.bounds[2] : d.bounds[1],
        });
      }
    }
    const metrics: Record<string, number> = {};
    for (const id of KEY_METRICS) if (f.values[id] !== undefined) metrics[id] = f.values[id] as number;
    const rloc = f.values.rloc ?? 0;
    return {
      path: f.path,
      rank: i + 1,
      basis: withChange ? "complexity-and-change" : "complexity-and-size",
      metrics,
      exceeded,
      actions: actionsFor(f, exceeded, extras),
      size: rloc < 150 ? "S" : rloc < 500 ? "M" : "L",
    };
  });
}

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Experimental: links between files that the folder structure and the imports do not show. */
export function findHiddenLinks(extras: HealthExtras, limit = 10): HiddenLink[] {
  const out: HiddenLink[] = [];
  const imports = extras.imports ?? [];
  const linked = new Set(imports.flatMap(([a, b]) => [`${a}\0${b}`, `${b}\0${a}`]));
  for (const [a, b] of extras.coChange ?? []) {
    if (folderOf(a) === folderOf(b) || linked.has(`${a}\0${b}`)) continue;
    out.push({
      kind: "co-change-without-import",
      files: [a, b].sort(),
      detail: "These files change together but neither imports the other.",
    });
  }
  const byFile = new Map<string, { own: number; elsewhere: Map<string, number> }>();
  for (const [from, to] of imports) {
    const entry = byFile.get(from) ?? { own: 0, elsewhere: new Map<string, number>() };
    if (folderOf(to) === folderOf(from)) entry.own++;
    else entry.elsewhere.set(folderOf(to), (entry.elsewhere.get(folderOf(to)) ?? 0) + 1);
    byFile.set(from, entry);
  }
  for (const [file, entry] of byFile) {
    const [folder, count] = [...entry.elsewhere].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0] ?? [
      "",
      0,
    ];
    const total = entry.own + [...entry.elsewhere.values()].reduce((a, b) => a + b, 0);
    if (total >= 4 && count > entry.own && count / total > 0.5) {
      out.push({
        kind: "imports-mostly-elsewhere",
        files: [file],
        detail: `${count} of its ${total} imports go to ${folder || "the root folder"}: it may belong there.`,
      });
    }
  }
  return out.sort((x, y) => (x.files.join() < y.files.join() ? -1 : 1)).slice(0, limit);
}

/** The health of a frame, as kept in the timeline manifest. */
export function frameHealth(
  files: readonly HealthFile[],
  dimensions: readonly RiskDimension[],
  top = 5,
): FrameHealth {
  const health = computeHealth(files, dimensions);
  return {
    score: health.score,
    profile: health.profile,
    hotspots: findHotspots(files, dimensions, {}, top).map((h) => h.path),
  };
}
